import { randomUUID } from 'node:crypto';
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
import type { TransactionResponse } from '../src/transactions/transaction-response.js';
import { setCookieHeaders } from './support/cookies.js';

const expense = SYSTEM_CATEGORIES[0];
const income = SYSTEM_CATEGORIES[4];
const validInput = {
  type: 'EXPENSE',
  amount: '12.34',
  categoryId: expense.id,
  title: 'Zakupy spożywcze',
  occurredOn: '2026-11-12',
};

describe('Transaction and category API (PostgreSQL)', () => {
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
    const email = `transaction-api-${randomUUID()}@example.invalid`;
    const password = 'Transaction integration test password 123!';
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

  it('requires a session for categories and transaction creation', async () => {
    await request(app.getHttpServer()).get('/categories').expect(401);
    await request(app.getHttpServer())
      .post('/transactions')
      .set('Origin', origin)
      .send(validInput)
      .expect(401);
  });

  it('returns categories in a stable order and filters by transaction type', async () => {
    const { agent } = await createAccount();
    const categories = await prisma.category.findMany({
      orderBy: { id: 'asc' },
    });
    const all = await agent.get('/categories').expect(200);
    expect(all.body).toEqual(categories);
    expect(all.body).toEqual(expect.arrayContaining([...SYSTEM_CATEGORIES]));
    expect(all.headers['cache-control']).toBe('no-store');

    for (const type of ['INCOME', 'EXPENSE']) {
      const filtered = await agent
        .get('/categories')
        .query({ type })
        .expect(200);
      expect(filtered.body).toEqual(
        categories.filter((item) => item.type === type),
      );
    }

    for (const query of [
      '?type=',
      '?type=income',
      '?type=OTHER',
      '?type=INCOME&type=EXPENSE',
      '?type[]=INCOME',
      '?unknown=value',
    ]) {
      await agent.get('/categories' + query).expect(400);
    }
  });

  it.each([expense, income])(
    'creates a $type for the session wallet and returns a serialized resource',
    async (category) => {
      const { agent, wallet } = await createAccount();
      const input = {
        ...validInput,
        type: category.type,
        categoryId: category.id,
        title: '  Operacja testowa  ',
        note: '  Notatka zachowuje spacje  ',
      };
      const response = await agent
        .post('/transactions')
        .set('Origin', origin)
        .set('Sec-Fetch-Site', 'same-site')
        .send(input)
        .expect(201);
      const transaction = response.body as TransactionResponse;
      expect(transaction).toEqual({
        id: expect.any(String),
        walletId: wallet.id,
        type: category.type,
        amount: '12.34',
        categoryId: category.id,
        title: 'Operacja testowa',
        note: input.note,
        occurredOn: '2026-11-12',
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      expect(new Date(transaction.createdAt).toISOString()).toBe(
        transaction.createdAt,
      );
      expect(new Date(transaction.updatedAt).toISOString()).toBe(
        transaction.updatedAt,
      );
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['access-control-allow-origin']).toBe(origin);
      expect(response.headers['access-control-allow-credentials']).toBe('true');

      const stored = await prisma.transaction.findUniqueOrThrow({
        where: { id: transaction.id },
      });
      expect(stored.walletId).toBe(wallet.id);
      expect(stored.amount.toFixed(2)).toBe('12.34');
      expect(stored.occurredOn.toISOString()).toBe('2026-11-12T00:00:00.000Z');
      expect(
        await prisma.wallet.findUnique({ where: { id: wallet.id } }),
      ).toEqual(wallet);
    },
  );

  it.each(['0.01', '0.10', '0.20', '999999999999.99'])(
    'preserves the cents of %s in the database and response',
    async (amount) => {
      const { agent } = await createAccount();
      const response = await agent
        .post('/transactions')
        .send({ ...validInput, amount })
        .expect(201);
      const transaction = response.body as TransactionResponse;
      expect(transaction.amount).toBe(amount);
      expect(transaction.note).toBeNull();
      const stored = await prisma.transaction.findUniqueOrThrow({
        where: { id: transaction.id },
      });
      expect(stored.amount.toFixed(2)).toBe(amount);
      expect(stored.note).toBeNull();
    },
  );

  it.each([
    '0001-01-01',
    '2024-02-29',
    '2026-03-29',
    '2026-10-25',
    '9999-12-31',
  ])(
    'preserves the calendar date %s, including leap days and future dates',
    async (occurredOn) => {
      const { agent } = await createAccount();
      const response = await agent
        .post('/transactions')
        .send({ ...validInput, occurredOn })
        .expect(201);
      const transaction = response.body as TransactionResponse;
      expect(transaction.occurredOn).toBe(occurredOn);
      const stored = await prisma.transaction.findUniqueOrThrow({
        where: { id: transaction.id },
      });
      expect(stored.occurredOn.toISOString()).toBe(
        occurredOn + 'T00:00:00.000Z',
      );
    },
  );

  it('accepts field length limits and an empty optional note', async () => {
    const { agent } = await createAccount();
    for (const note of ['', 'ą'.repeat(1000)]) {
      const response = await agent
        .post('/transactions')
        .send({ ...validInput, title: '  ' + 'ą'.repeat(100) + '  ', note })
        .expect(201);
      expect(response.body.title).toBe('ą'.repeat(100));
      expect(response.body.note).toBe(note);
    }
  });

  it('rejects invalid amounts before inserting or rounding them', async () => {
    const { agent, wallet } = await createAccount();
    for (const amount of [
      undefined,
      null,
      12.34,
      true,
      [],
      {},
      '',
      '0.00',
      '-0.00',
      '-0.01',
      '12',
      '12.3',
      '12.345',
      '0.001',
      '12,34',
      '+12.34',
      '01.00',
      '.10',
      '1e2',
      'NaN',
      'Infinity',
      ' 12.34',
      '12.34 ',
      '12.34\n',
      '12.34\r\n',
      '1 000.00',
      '1000000000000.00',
      '9'.repeat(1000) + '.00',
    ]) {
      const response = await agent
        .post('/transactions')
        .send({ ...validInput, amount });
      expect(response.status, JSON.stringify({ amount })).toBe(400);
    }
    expect(
      await prisma.transaction.count({ where: { walletId: wallet.id } }),
    ).toBe(0);
  });

  it('rejects nonexistent, malformed or out-of-range dates', async () => {
    const { agent, wallet } = await createAccount();
    for (const occurredOn of [
      undefined,
      null,
      20261112,
      true,
      [],
      {},
      '',
      '0000-01-01',
      '10000-01-01',
      '2026-02-29',
      '1900-02-29',
      '2026-04-31',
      '2026-00-01',
      '2026-13-01',
      '2026-01-00',
      '2026-01-32',
      '2026-2-01',
      '2026-02-1',
      '12-11-2026',
      '2026-11-12T00:00:00.000Z',
      '2026-11-12\n',
      ' 2026-11-12',
      'infinity',
      '-infinity',
    ]) {
      const response = await agent
        .post('/transactions')
        .send({ ...validInput, occurredOn });
      expect(response.status, JSON.stringify({ occurredOn })).toBe(400);
    }
    expect(
      await prisma.transaction.count({ where: { walletId: wallet.id } }),
    ).toBe(0);
  });

  it('validates required fields, enums, UUIDs and text limits', async () => {
    const { agent, wallet } = await createAccount();
    const invalid: Record<string, unknown>[] = [
      { type: undefined },
      { type: null },
      { type: 'expense' },
      { type: 'OTHER' },
      { type: [] },
      { type: {} },
      { categoryId: undefined },
      { categoryId: null },
      { categoryId: 123 },
      { categoryId: 'not-a-uuid' },
      { categoryId: [] },
      { categoryId: {} },
      { title: undefined },
      { title: null },
      { title: '' },
      { title: ' \n\t ' },
      { title: 'a'.repeat(101) },
      { title: 123 },
      { title: [] },
      { title: {} },
      { note: null },
      { note: 123 },
      { note: [] },
      { note: {} },
      { note: 'a'.repeat(1001) },
    ];
    for (const changes of invalid) {
      const response = await agent
        .post('/transactions')
        .send({ ...validInput, ...changes });
      expect(response.status, JSON.stringify(changes)).toBe(400);
    }
    await agent.post('/transactions').send({}).expect(400);
    expect(
      await prisma.transaction.count({ where: { walletId: wallet.id } }),
    ).toBe(0);
  });

  it('rejects unknown categories and both directions of type mismatch', async () => {
    const { agent, wallet } = await createAccount();
    for (const changes of [
      { categoryId: randomUUID() },
      { categoryId: income.id },
      { type: 'INCOME', categoryId: expense.id },
    ]) {
      await agent
        .post('/transactions')
        .send({ ...validInput, ...changes })
        .expect(400);
    }
    expect(
      await prisma.transaction.count({ where: { walletId: wallet.id } }),
    ).toBe(0);
  });

  it('rejects JSON bodies that are not objects', async () => {
    const { agent, wallet } = await createAccount();
    for (const body of ['null', '[]', '[{}]', '"text"', '42']) {
      await agent
        .post('/transactions')
        .set('Content-Type', 'application/json')
        .send(body)
        .expect(400);
    }
    expect(
      await prisma.transaction.count({ where: { walletId: wallet.id } }),
    ).toBe(0);
  });

  it('uses only the session wallet and rejects ownership, relation and read-only fields', async () => {
    const a = await createAccount();
    const b = await createAccount();
    for (const extra of [
      { walletId: b.wallet.id },
      { userId: b.user.id },
      { id: randomUUID() },
      { createdAt: '2020-01-01T00:00:00.000Z' },
      { updatedAt: '2020-01-01T00:00:00.000Z' },
      { wallet: { connect: { id: b.wallet.id } } },
      { category: { connect: { id: income.id } } },
      { currency: 'PLN' },
    ]) {
      await a.agent
        .post('/transactions')
        .send({ ...validInput, ...extra })
        .expect(400);
    }
    const response = await a.agent
      .post('/transactions')
      .query({ userId: b.user.id, walletId: b.wallet.id, id: b.wallet.id })
      .send(validInput)
      .expect(201);
    expect(response.body.walletId).toBe(a.wallet.id);
    expect(
      await prisma.transaction.count({ where: { walletId: a.wallet.id } }),
    ).toBe(1);
    expect(
      await prisma.transaction.count({ where: { walletId: b.wallet.id } }),
    ).toBe(0);
    await b.agent.post('/transactions').send(validInput).expect(201);
    const storedB = await prisma.transaction.findMany({
      where: { walletId: b.wallet.id },
    });
    expect(storedB).toHaveLength(1);
    expect(storedB[0]!.id).not.toBe(response.body.id);
  });

  it('blocks untrusted browser writes before inserting a transaction', async () => {
    const { agent, wallet } = await createAccount();
    for (const headers of [
      { Origin: 'https://foreign.example', 'Sec-Fetch-Site': 'cross-site' },
      { Origin: 'http://localhost:4444', 'Sec-Fetch-Site': 'same-site' },
      { Origin: 'null' },
      { 'Sec-Fetch-Site': 'cross-site' },
    ]) {
      await agent
        .post('/transactions')
        .set(headers)
        .send(validInput)
        .expect(403);
    }
    expect(
      await prisma.transaction.count({ where: { walletId: wallet.id } }),
    ).toBe(0);
    await agent.get('/categories').expect(200);
  });

  it('allows the credentialed POST preflight from the configured frontend', async () => {
    const response = await request(app.getHttpServer())
      .options('/transactions')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type')
      .expect(204);
    expect(response.headers['access-control-allow-origin']).toBe(origin);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(
      response.headers['access-control-allow-methods'].split(','),
    ).toContain('POST');
  });

  it('rejects expired and logged-out sessions on both endpoints', async () => {
    const account = await createAccount();
    const loggedOut = await createAccount();
    await prisma.session.update({
      where: { sid: account.sid },
      data: { expire: new Date(0) },
    });
    await loggedOut.agent.post('/auth/logout').expect(204);
    for (const { cookie, wallet } of [account, loggedOut]) {
      await request(app.getHttpServer())
        .get('/categories')
        .set('Cookie', cookie)
        .expect(401);
      await request(app.getHttpServer())
        .post('/transactions')
        .set('Cookie', cookie)
        .send(validInput)
        .expect(401);
      expect(
        await prisma.transaction.count({ where: { walletId: wallet.id } }),
      ).toBe(0);
    }
  });

  it('returns 404 for a missing wallet without recreating it', async () => {
    const { agent, user } = await createAccount();
    await prisma.wallet.delete({ where: { userId: user.id } });
    await agent.post('/transactions').send(validInput).expect(404);
    expect(await prisma.wallet.count({ where: { userId: user.id } })).toBe(0);
  });

  it('returns a safe validation error if a reference changes between lookup and insertion', async () => {
    const { agent, wallet } = await createAccount();
    vi.spyOn(prisma.transaction, 'create').mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('private foreign key details', {
        code: 'P2003',
        clientVersion: Prisma.prismaVersion.client,
      }),
    );
    const response = await agent
      .post('/transactions')
      .send(validInput)
      .expect(400);
    expect(response.body.message).toBe(
      'Portfel lub kategoria nie są już dostępne.',
    );
    expect(
      await prisma.transaction.count({ where: { walletId: wallet.id } }),
    ).toBe(0);
  });

  it.each(['categories', 'wallet', 'category', 'create'] as const)(
    'sanitizes database errors during %s without logging transaction contents',
    async (operation) => {
      const { agent, wallet } = await createAccount();
      const privateDetail =
        'private-transaction-query-with-sensitive-arguments';
      const log = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});
      const error = new Error(privateDetail);
      if (operation === 'categories') {
        vi.spyOn(prisma.category, 'findMany').mockRejectedValueOnce(error);
      } else if (operation === 'wallet') {
        vi.spyOn(prisma.wallet, 'findUnique').mockRejectedValueOnce(error);
      } else if (operation === 'category') {
        vi.spyOn(prisma.category, 'findUnique').mockRejectedValueOnce(error);
      } else {
        vi.spyOn(prisma.transaction, 'create').mockRejectedValueOnce(error);
      }
      const response = await (
        operation === 'categories'
          ? agent.get('/categories')
          : agent
              .post('/transactions')
              .send({ ...validInput, note: privateDetail })
      ).expect(500);
      expect(response.body.message).toBe(
        operation === 'categories'
          ? 'Nie udało się pobrać kategorii.'
          : 'Nie udało się zapisać transakcji.',
      );
      expect(log).toHaveBeenCalled();
      expect(JSON.stringify([response.body, log.mock.calls])).not.toContain(
        privateDetail,
      );
      expect(
        await prisma.transaction.count({ where: { walletId: wallet.id } }),
      ).toBe(0);
    },
  );
});
