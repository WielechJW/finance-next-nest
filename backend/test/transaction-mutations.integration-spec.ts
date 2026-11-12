import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import {
  seedSystemCategories,
  SYSTEM_CATEGORIES,
} from '../src/categories/system-categories.js';
import { configureApp } from '../src/config/configure-app.js';
import { getFrontendOrigin } from '../src/config/cors.js';
import { getAuthRateLimitOptions } from '../src/config/rate-limit.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import type { CreateTransactionDto } from '../src/transactions/dto/create-transaction.dto.js';
import type { TransactionResponse } from '../src/transactions/transaction-response.js';
import { setCookieHeaders } from './support/cookies.js';

const expense = SYSTEM_CATEGORIES[0];
const transport = SYSTEM_CATEGORIES[1];
const income = SYSTEM_CATEGORIES[4];
const otherIncome = SYSTEM_CATEGORIES[5];
const validInput = {
  type: 'EXPENSE',
  amount: '12.34',
  categoryId: expense.id,
  title: 'Zakupy',
  occurredOn: '2026-11-12',
  note: 'Notatka do operacji',
} as const;

describe('Transaction editing and deletion API (PostgreSQL)', () => {
  const origin = getFrontendOrigin();
  const userIds = new Set<string>();
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getOptionsToken())
      .useFactory({
        factory: () =>
          getAuthRateLimitOptions({
            AUTH_LOGIN_LIMIT: '1000',
            AUTH_REGISTER_LIMIT: '1000',
          }),
      })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await seedSystemCategories(prisma);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (prisma && userIds.size) {
      await prisma.session.deleteMany({
        where: {
          OR: [...userIds].map((id) => ({
            sess: { path: ['userId'], equals: id },
          })),
        },
      });
      await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } });
    }
    userIds.clear();
  });
  afterAll(async () => {
    await app?.close();
  });

  async function createAccount() {
    const email = `transaction-edit-${randomUUID()}@example.invalid`;
    const password = 'Transaction editing test password 123!';
    const agent = request.agent(app.getHttpServer());
    const registration = await agent
      .post('/auth/register')
      .send({ email, password })
      .expect(201);
    const user = registration.body as { id: string };
    userIds.add(user.id);
    const login = await agent
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    const cookie = setCookieHeaders(login)
      .find((header) => header.startsWith('finance.sid='))!
      .split(';')[0]!;
    const sid = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1))
      .slice(2)
      .split('.')[0]!;
    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId: user.id },
    });
    return { agent, user, wallet, cookie, sid };
  }

  async function createTransaction(
    account: Awaited<ReturnType<typeof createAccount>>,
    changes: Partial<CreateTransactionDto> = {},
  ): Promise<TransactionResponse> {
    const response = await account.agent
      .post('/transactions')
      .set('Origin', origin)
      .send({ ...validInput, ...changes })
      .expect(201);
    return response.body as TransactionResponse;
  }

  it('requires a session for both mutation endpoints', async () => {
    const path = '/transactions/' + randomUUID();
    await request(app.getHttpServer())
      .patch(path)
      .set('Origin', origin)
      .send({ title: 'Zmiana' })
      .expect(401);
    await request(app.getHttpServer())
      .delete(path)
      .set('Origin', origin)
      .expect(401);
  });

  it('updates and deletes an expense while keeping the wallet and history exact', async () => {
    const account = await createAccount();
    await account.agent
      .patch('/wallet')
      .send({ openingBalance: '100.00' })
      .expect(200);
    await createTransaction(account, {
      type: 'INCOME',
      categoryId: income.id,
      amount: '50.20',
    });
    const transaction = await createTransaction(account, { amount: '20.10' });
    const before = await account.agent.get('/wallet').expect(200);
    expect(before.body.balance).toBe('130.10');

    const changed = await account.agent
      .patch('/transactions/' + transaction.id)
      .set('Origin', origin)
      .set('Sec-Fetch-Site', 'same-site')
      .send({ amount: '30.10', title: '  Poprawiony wydatek  ', note: null })
      .expect(200);
    expect(changed.body).toEqual({
      ...transaction,
      amount: '30.10',
      title: 'Poprawiony wydatek',
      note: null,
      updatedAt: expect.any(String),
    });
    expect(changed.headers['cache-control']).toBe('no-store');
    expect(changed.headers['access-control-allow-origin']).toBe(origin);
    expect(changed.headers['access-control-allow-credentials']).toBe('true');
    expect(new Date(changed.body.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(transaction.updatedAt).getTime(),
    );
    const updatedWallet = await account.agent.get('/wallet').expect(200);
    expect(updatedWallet.body).toMatchObject({
      openingBalance: '100.00',
      balance: '120.10',
    });
    const details = await account.agent
      .get('/transactions/' + transaction.id)
      .expect(200);
    expect(details.body).toEqual(changed.body);

    const removed = await account.agent
      .delete('/transactions/' + transaction.id)
      .set('Origin', origin)
      .expect(204);
    expect(removed.text).toBe('');
    expect(removed.headers['cache-control']).toBe('no-store');
    await account.agent.get('/transactions/' + transaction.id).expect(404);
    await account.agent.delete('/transactions/' + transaction.id).expect(404);
    const finalWallet = await account.agent.get('/wallet').expect(200);
    expect(finalWallet.body).toMatchObject({
      openingBalance: '100.00',
      balance: '150.20',
    });
    const history = await account.agent.get('/transactions').expect(200);
    expect(history.body.total).toBe(1);
    expect(history.body.items[0].type).toBe('INCOME');
  });

  it.each([
    { amount: '0.01' },
    { amount: '999999999999.99' },
    { categoryId: transport.id },
    { title: 'ą'.repeat(100) },
    { occurredOn: '0001-01-01' },
    { occurredOn: '2024-02-29' },
    { occurredOn: '9999-12-31' },
    { note: '' },
    { note: 'ą'.repeat(1000) },
    { note: null },
  ])('preserves omitted fields in a partial update (%#)', async (changes) => {
    const account = await createAccount();
    const transaction = await createTransaction(account);
    const response = await account.agent
      .patch('/transactions/' + transaction.id)
      .send(changes)
      .expect(200);
    expect(response.body).toEqual({
      ...transaction,
      ...changes,
      updatedAt: expect.any(String),
    });
    const stored = await prisma.transaction.findUniqueOrThrow({
      where: { id: transaction.id },
    });
    expect(stored.id).toBe(transaction.id);
    expect(stored.walletId).toBe(transaction.walletId);
    expect(stored.amount.toFixed(2)).toBe(response.body.amount);
    expect(stored.occurredOn.toISOString().slice(0, 10)).toBe(
      response.body.occurredOn,
    );
  });

  it('validates the final type and category for partial changes in both directions', async () => {
    const account = await createAccount();
    const transaction = await createTransaction(account);
    for (const changes of [
      { type: 'INCOME' },
      { categoryId: income.id },
      { type: 'INCOME', categoryId: transport.id },
      { categoryId: randomUUID() },
    ])
      await account.agent
        .patch('/transactions/' + transaction.id)
        .send(changes)
        .expect(400);
    const unchanged = await account.agent
      .get('/transactions/' + transaction.id)
      .expect(200);
    expect(unchanged.body).toEqual(transaction);
    const changed = await account.agent
      .patch('/transactions/' + transaction.id)
      .send({ type: 'INCOME', categoryId: income.id })
      .expect(200);
    expect(changed.body).toMatchObject({
      type: 'INCOME',
      categoryId: income.id,
    });
    const wallet = await account.agent.get('/wallet').expect(200);
    expect(wallet.body.balance).toBe('12.34');
    await account.agent
      .patch('/transactions/' + transaction.id)
      .send({ type: 'EXPENSE' })
      .expect(400);
    await account.agent
      .patch('/transactions/' + transaction.id)
      .send({ categoryId: transport.id })
      .expect(400);
    await account.agent
      .patch('/transactions/' + transaction.id)
      .send({ categoryId: otherIncome.id })
      .expect(200);
    await account.agent
      .patch('/transactions/' + transaction.id)
      .send({ type: 'EXPENSE', categoryId: expense.id })
      .expect(200);
    const back = await account.agent.get('/wallet').expect(200);
    expect(back.body.balance).toBe('-12.34');
  });

  it('rejects invalid values and nulls without modifying the transaction or wallet balance', async () => {
    const account = await createAccount();
    const transaction = await createTransaction(account);
    const invalid: Record<string, unknown>[] = [
      {},
      { type: null },
      { type: 'income' },
      { type: [] },
      { type: {} },
      { amount: null },
      { amount: 12.34 },
      { amount: false },
      { amount: [] },
      { amount: {} },
      ...[
        '',
        '0.00',
        '-0.00',
        '-0.01',
        '12',
        '12.3',
        '0.001',
        '12,34',
        '+12.34',
        '01.00',
        '1e2',
        'NaN',
        'Infinity',
        '12.34\n',
        ' 12.34',
        '1000000000000.00',
      ].map((amount) => ({ amount })),
      { categoryId: null },
      { categoryId: 123 },
      { categoryId: 'invalid' },
      { categoryId: [] },
      { title: null },
      { title: '' },
      { title: ' \n\t ' },
      { title: 'a'.repeat(101) },
      { title: [] },
      { title: {} },
      { occurredOn: null },
      { occurredOn: true },
      { occurredOn: [] },
      ...[
        '0000-01-01',
        '10000-01-01',
        '2026-02-29',
        '2026-04-31',
        '2026-11-12T00:00:00Z',
        '2026-11-12\n',
      ].map((occurredOn) => ({ occurredOn })),
      { note: 123 },
      { note: [] },
      { note: {} },
      { note: 'a'.repeat(1001) },
    ];
    for (const changes of invalid) {
      const response = await account.agent
        .patch('/transactions/' + transaction.id)
        .send(changes);
      expect(response.status, JSON.stringify(changes)).toBe(400);
    }
    const read = await account.agent
      .get('/transactions/' + transaction.id)
      .expect(200);
    expect(read.body).toEqual(transaction);
    const wallet = await account.agent.get('/wallet').expect(200);
    expect(wallet.body.balance).toBe('-12.34');
  });

  it('rejects bodies that are not JSON objects', async () => {
    const account = await createAccount();
    const transaction = await createTransaction(account);
    for (const body of ['null', '[]', '[{}]', '"text"', '42', 'true']) {
      await account.agent
        .patch('/transactions/' + transaction.id)
        .set('Content-Type', 'application/json')
        .send(body)
        .expect(400);
    }
    const read = await account.agent
      .get('/transactions/' + transaction.id)
      .expect(200);
    expect(read.body).toEqual(transaction);
  });

  it('rejects ownership and read-only fields and ignores URL attempts to redirect ownership', async () => {
    const a = await createAccount();
    const b = await createAccount();
    const own = await createTransaction(a);
    const other = await createTransaction(b);
    for (const extra of [
      { id: other.id },
      { userId: b.user.id },
      { walletId: b.wallet.id },
      { createdAt: '2020-01-01T00:00:00.000Z' },
      { updatedAt: '2020-01-01T00:00:00.000Z' },
      { currency: 'PLN' },
      { balance: '999.99' },
      { openingBalance: '999.99' },
      { wallet: { connect: { id: b.wallet.id } } },
      { category: { connect: { id: income.id } } },
    ])
      await a.agent
        .patch('/transactions/' + own.id)
        .send({ title: 'Niedozwolona zmiana', ...extra })
        .expect(400);
    const rejected = await a.agent.get('/transactions/' + own.id).expect(200);
    expect(rejected.body).toEqual(own);
    const changed = await a.agent
      .patch('/transactions/' + own.id)
      .query({ userId: b.user.id, walletId: b.wallet.id, id: other.id })
      .send({ amount: '0.10' })
      .expect(200);
    expect(changed.body).toMatchObject({
      id: own.id,
      walletId: a.wallet.id,
      amount: '0.10',
    });
    await a.agent
      .delete('/transactions/' + own.id)
      .query({ userId: b.user.id, walletId: b.wallet.id, id: other.id })
      .expect(204);
    const unchangedB = await b.agent
      .get('/transactions/' + other.id)
      .expect(200);
    expect(unchangedB.body).toEqual(other);
    const walletB = await b.agent.get('/wallet').expect(200);
    expect(walletB.body.balance).toBe('-12.34');
  });

  it.each(['patch', 'delete'] as const)(
    'returns identical 404 responses for foreign and missing records during %s',
    async (method) => {
      const a = await createAccount();
      const b = await createAccount();
      const other = await createTransaction(b);
      const foreign = a.agent[method]('/transactions/' + other.id);
      if (method === 'patch') {
        foreign.send({ amount: '99.99' });
      }
      const denied = await foreign.expect(404);
      const missing = a.agent[method]('/transactions/' + randomUUID());
      if (method === 'patch') missing.send({ amount: '99.99' });
      const absent = await missing.expect(404);
      expect(denied.body).toEqual(absent.body);
      expect(denied.body.message).toBe('Nie znaleziono transakcji.');
      for (const id of ['invalid', '123', '20000000-0000-4000-8000-invalid']) {
        const operation = a.agent[method]('/transactions/' + id);
        if (method === 'patch') operation.send({ amount: '99.99' });
        await operation.expect(400);
      }
      const read = await b.agent.get('/transactions/' + other.id).expect(200);
      expect(read.body).toEqual(other);
      const walletA = await a.agent.get('/wallet').expect(200);
      expect(walletA.body.balance).toBe('0.00');
      const walletB = await b.agent.get('/wallet').expect(200);
      expect(walletB.body.balance).toBe('-12.34');
    },
  );

  it('blocks foreign browser writes before changing or deleting records', async () => {
    const account = await createAccount();
    const transaction = await createTransaction(account);
    for (const headers of [
      { Origin: 'https://foreign.example', 'Sec-Fetch-Site': 'cross-site' },
      { Origin: 'http://localhost:4444', 'Sec-Fetch-Site': 'same-site' },
      { Origin: 'null' },
      { 'Sec-Fetch-Site': 'cross-site' },
    ]) {
      await account.agent
        .patch('/transactions/' + transaction.id)
        .set(headers)
        .send({ amount: '99.99' })
        .expect(403);
      await account.agent
        .delete('/transactions/' + transaction.id)
        .set(headers)
        .expect(403);
    }
    const read = await account.agent
      .get('/transactions/' + transaction.id)
      .expect(200);
    expect(read.body).toEqual(transaction);
  });

  it.each(['PATCH', 'DELETE'])(
    'allows the credentialed %s preflight from the configured frontend',
    async (method) => {
      const response = await request(app.getHttpServer())
        .options('/transactions/' + randomUUID())
        .set('Origin', origin)
        .set('Access-Control-Request-Method', method)
        .set('Access-Control-Request-Headers', 'content-type')
        .expect(204);
      expect(response.headers['access-control-allow-origin']).toBe(origin);
      expect(response.headers['access-control-allow-credentials']).toBe('true');
      expect(
        response.headers['access-control-allow-methods'].split(','),
      ).toContain(method);
      expect(
        response.headers['access-control-allow-headers'].toLowerCase(),
      ).toContain('content-type');
    },
  );

  it('rejects expired and logged-out cookies on both endpoints', async () => {
    const expired = await createAccount();
    const loggedOut = await createAccount();
    const records = await Promise.all([
      createTransaction(expired),
      createTransaction(loggedOut),
    ]);
    await prisma.session.update({
      where: { sid: expired.sid },
      data: { expire: new Date(0) },
    });
    await loggedOut.agent.post('/auth/logout').expect(204);
    for (const [index, account] of [expired, loggedOut].entries()) {
      const id = records[index]!.id;
      await request(app.getHttpServer())
        .patch('/transactions/' + id)
        .set('Cookie', account.cookie)
        .set('Origin', origin)
        .send({ amount: '99.99' })
        .expect(401);
      await request(app.getHttpServer())
        .delete('/transactions/' + id)
        .set('Cookie', account.cookie)
        .set('Origin', origin)
        .expect(401);
      const stored = await prisma.transaction.findUniqueOrThrow({
        where: { id },
      });
      expect(stored.amount.toFixed(2)).toBe('12.34');
    }
  });

  it('preserves independent fields during parallel partial updates', async () => {
    const account = await createAccount();
    const transaction = await createTransaction(account);
    await Promise.all([
      account.agent
        .patch('/transactions/' + transaction.id)
        .send({ title: 'Nowy tytuł' })
        .expect(200),
      account.agent
        .patch('/transactions/' + transaction.id)
        .send({ amount: '0.10' })
        .expect(200),
    ]);
    const read = await account.agent
      .get('/transactions/' + transaction.id)
      .expect(200);
    expect(read.body).toMatchObject({
      title: 'Nowy tytuł',
      amount: '0.10',
      type: 'EXPENSE',
      categoryId: expense.id,
    });
  });

  it('validates a partial category edit against the latest type after waiting for a concurrent writer', async () => {
    const account = await createAccount();
    const transaction = await createTransaction(account);
    let patch!: Promise<request.Response>;
    await prisma.$transaction(async (database) => {
      const [owner] = await database.$queryRaw<
        { pid: number }[]
      >`SELECT pg_backend_pid() AS pid`;
      await database.transaction.update({
        where: { id: transaction.id },
        data: { type: 'INCOME', categoryId: income.id },
      });
      patch = account.agent
        .patch('/transactions/' + transaction.id)
        .send({ categoryId: otherIncome.id })
        .then((response) => response);
      const deadline = Date.now() + 2000;
      let waiting = false;
      while (!waiting && Date.now() < deadline) {
        const [result] = await prisma.$queryRaw<{ waiting: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity a
            WHERE a.datname = current_database()
              AND ${owner!.pid} = ANY(pg_blocking_pids(a.pid))
          ) AS waiting
        `;
        waiting = result!.waiting;
        if (!waiting) await delay(10);
      }
      expect(waiting).toBe(true);
    });
    const response = await patch;
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      type: 'INCOME',
      categoryId: otherIncome.id,
    });
    const read = await account.agent
      .get('/transactions/' + transaction.id)
      .expect(200);
    expect(read.body).toMatchObject({
      type: 'INCOME',
      categoryId: otherIncome.id,
    });
  });

  it('handles parallel type/category edits without leaving an inconsistent pair', async () => {
    const account = await createAccount();
    const transaction = await createTransaction(account);
    const [retyped, recategorized] = await Promise.all([
      account.agent
        .patch('/transactions/' + transaction.id)
        .send({ type: 'INCOME', categoryId: income.id }),
      account.agent
        .patch('/transactions/' + transaction.id)
        .send({ categoryId: transport.id }),
    ]);
    expect(retyped.status).toBe(200);
    expect([200, 400]).toContain(recategorized.status);
    const read = await account.agent
      .get('/transactions/' + transaction.id)
      .expect(200);
    expect(read.body).toMatchObject({ type: 'INCOME', categoryId: income.id });
  });

  it('allows exactly one concurrent deletion of the same record', async () => {
    const account = await createAccount();
    const transaction = await createTransaction(account);
    const results = await Promise.all([
      account.agent.delete('/transactions/' + transaction.id),
      account.agent.delete('/transactions/' + transaction.id),
    ]);
    expect(
      results.map((result) => result.status).sort((a, b) => a - b),
    ).toEqual([204, 404]);
    const wallet = await account.agent.get('/wallet').expect(200);
    expect(wallet.body.balance).toBe('0.00');
  });

  it('handles an edit racing with deletion without recreating the record', async () => {
    const account = await createAccount();
    const transaction = await createTransaction(account);
    const [changed, removed] = await Promise.all([
      account.agent
        .patch('/transactions/' + transaction.id)
        .send({ amount: '0.10' }),
      account.agent.delete('/transactions/' + transaction.id),
    ]);
    expect([200, 404]).toContain(changed.status);
    expect(removed.status).toBe(204);
    expect(
      await prisma.transaction.count({ where: { id: transaction.id } }),
    ).toBe(0);
  });

  it('maps a changed foreign-key reference to a safe validation error', async () => {
    const account = await createAccount();
    const transaction = await createTransaction(account);
    vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('private SQL details', {
        code: 'P2003',
        clientVersion: Prisma.prismaVersion.client,
      }),
    );
    const response = await account.agent
      .patch('/transactions/' + transaction.id)
      .send({ amount: '0.10' })
      .expect(400);
    expect(response.body.message).toBe(
      'Portfel lub kategoria nie są już dostępne.',
    );
    const read = await account.agent
      .get('/transactions/' + transaction.id)
      .expect(200);
    expect(read.body).toEqual(transaction);
  });

  it.each(['patch', 'delete'] as const)(
    'sanitizes database errors during %s without exposing private notes',
    async (method) => {
      const account = await createAccount();
      const transaction = await createTransaction(account);
      const detail = 'private-query-arguments-and-transaction-note';
      const log = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});
      if (method === 'patch')
        vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(
          new Error(detail),
        );
      else
        vi.spyOn(prisma.transaction, 'delete').mockRejectedValueOnce(
          new Error(detail),
        );
      const operation = account.agent[method](
        '/transactions/' + transaction.id,
      );
      if (method === 'patch') operation.send({ note: detail });
      const response = await operation.expect(500);
      expect(response.body.message).toBe(
        method === 'patch'
          ? 'Nie udało się zmienić transakcji.'
          : 'Nie udało się usunąć transakcji.',
      );
      expect(log).toHaveBeenCalled();
      expect(JSON.stringify([response.body, log.mock.calls])).not.toContain(
        detail,
      );
      const read = await account.agent
        .get('/transactions/' + transaction.id)
        .expect(200);
      expect(read.body).toEqual(transaction);
    },
  );
});
