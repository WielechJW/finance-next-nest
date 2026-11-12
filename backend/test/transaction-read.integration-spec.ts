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
import { PrismaService } from '../src/prisma/prisma.service.js';
import type {
  TransactionListResponse,
  TransactionResponse,
} from '../src/transactions/transaction-response.js';
import { setCookieHeaders } from './support/cookies.js';

const expense = SYSTEM_CATEGORIES[0];
const transport = SYSTEM_CATEGORIES[1];
const income = SYSTEM_CATEGORIES[4];

describe('Transaction history and details API (PostgreSQL)', () => {
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
    const email = `transaction-read-${randomUUID()}@example.invalid`;
    const password = 'Transaction history test password 123!';
    const agent = request.agent(app.getHttpServer());
    const registered = await agent
      .post('/auth/register')
      .send({ email, password })
      .expect(201);
    const user = registered.body as { id: string };
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

  async function createHistory(
    account: Awaited<ReturnType<typeof createAccount>>,
  ) {
    const prefix = randomUUID().slice(0, 24);
    const entries = [
      { category: expense, amount: '0.10', day: '2026-10-31' },
      { category: expense, amount: '12.34', day: '2026-11-01' },
      { category: expense, amount: '0.20', day: '2026-11-12' },
      { category: income, amount: '50.20', day: '2026-11-12' },
      { category: transport, amount: '4.50', day: '2026-11-12' },
      { category: expense, amount: '0.01', day: '2026-11-30' },
      { category: expense, amount: '1.00', day: '2026-12-01' },
    ].map(({ category, amount, day }, index) => ({
      id: prefix + (index + 1).toString(16).padStart(12, '0'),
      walletId: account.wallet.id,
      type: category.type,
      categoryId: category.id,
      amount,
      title: `Operacja ${index + 1}`,
      note: index % 2 === 0 ? null : 'Notatka testowa',
      occurredOn: new Date(day + 'T00:00:00.000Z'),
    }));
    await prisma.transaction.createMany({ data: entries });
    return entries;
  }

  it('requires a session for both list and details', async () => {
    await request(app.getHttpServer()).get('/transactions').expect(401);
    await request(app.getHttpServer())
      .get('/transactions/' + randomUUID())
      .expect(401);
  });

  it('returns an empty collection with default pagination and no caching', async () => {
    const { agent } = await createAccount();
    const response = await agent
      .get('/transactions')
      .set('Origin', origin)
      .expect(200);
    expect(response.body).toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['access-control-allow-origin']).toBe(origin);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it.each(['0001-01-01', '2024-02-29', '9999-12-31'])(
    'returns the same resource as POST with exact money and the calendar date %s',
    async (occurredOn) => {
      const { agent } = await createAccount();
      const created = await agent
        .post('/transactions')
        .set('Origin', origin)
        .send({
          type: 'EXPENSE',
          categoryId: expense.id,
          amount: '0.10',
          title: 'Grosze i data',
          occurredOn,
        })
        .expect(201);
      const transaction = created.body as TransactionResponse;
      const details = await agent
        .get('/transactions/' + transaction.id)
        .expect(200);
      expect(details.body).toEqual(transaction);
      expect(details.headers['cache-control']).toBe('no-store');
      expect(details.body.amount).toBe('0.10');
      expect(details.body.occurredOn).toBe(occurredOn);
      expect(details.body.note).toBeNull();
      const list = await agent
        .get('/transactions')
        .query({ from: occurredOn, to: occurredOn })
        .expect(200);
      expect(list.body).toEqual({
        items: [transaction],
        page: 1,
        pageSize: 20,
        total: 1,
      });
    },
  );

  it('returns only the session history for two accounts', async () => {
    const a = await createAccount();
    const b = await createAccount();
    const historyA = await createHistory(a);
    const historyB = await createHistory(b);
    for (const [account, history] of [
      [a, historyA],
      [b, historyB],
    ] as const) {
      const response = await account.agent.get('/transactions').expect(200);
      const body = response.body as TransactionListResponse;
      expect(body.total).toBe(7);
      expect(body.items.map((item) => item.id)).toEqual(
        history.toReversed().map((item) => item.id),
      );
      expect(
        body.items.every((item) => item.walletId === account.wallet.id),
      ).toBe(true);
    }
    await a.agent
      .get('/transactions')
      .query({ walletId: b.wallet.id })
      .expect(400);
    await a.agent.get('/transactions').query({ userId: b.user.id }).expect(400);
  });

  it('paginates in date/id descending order without duplicating equal-date records', async () => {
    const account = await createAccount();
    const history = await createHistory(account);
    const ids: string[] = [];
    for (let page = 1; page <= 4; page += 1) {
      const response = await account.agent
        .get('/transactions')
        .query({ page, pageSize: 2 })
        .expect(200);
      const body = response.body as TransactionListResponse;
      expect(body).toMatchObject({ page, pageSize: 2, total: 7 });
      expect(body.items).toHaveLength(page === 4 ? 1 : 2);
      ids.push(...body.items.map((item) => item.id));
    }
    expect(ids).toEqual(history.toReversed().map((item) => item.id));
    expect(new Set(ids).size).toBe(7);
    const beyond = await account.agent
      .get('/transactions')
      .query({ page: 5, pageSize: 2 })
      .expect(200);
    expect(beyond.body).toEqual({ items: [], page: 5, pageSize: 2, total: 7 });
    const largest = await account.agent
      .get('/transactions')
      .query({ pageSize: 100 })
      .expect(200);
    expect(largest.body.items).toHaveLength(7);
    expect(largest.body.pageSize).toBe(100);
    const lastSupported = await account.agent
      .get('/transactions')
      .query({ page: 2147483647, pageSize: 1 })
      .expect(200);
    expect(lastSupported.body).toEqual({
      items: [],
      page: 2147483647,
      pageSize: 1,
      total: 7,
    });
  });

  it.each([
    { name: 'type', query: { type: 'INCOME' }, indices: [3], total: 1 },
    {
      name: 'expense category',
      query: { categoryId: expense.id },
      indices: [6, 5, 2, 1, 0],
      total: 5,
    },
    {
      name: 'transport category',
      query: { categoryId: transport.id },
      indices: [4],
      total: 1,
    },
    {
      name: 'inclusive month boundaries',
      query: { from: '2026-11-01', to: '2026-11-30' },
      indices: [5, 4, 3, 2, 1],
      total: 5,
    },
    {
      name: 'lower boundary only',
      query: { from: '2026-11-30' },
      indices: [6, 5],
      total: 2,
    },
    {
      name: 'upper boundary only',
      query: { to: '2026-11-01' },
      indices: [1, 0],
      total: 2,
    },
    {
      name: 'one calendar day',
      query: { from: '2026-11-12', to: '2026-11-12' },
      indices: [4, 3, 2],
      total: 3,
    },
    {
      name: 'combined filters and pagination',
      query: {
        type: 'EXPENSE',
        categoryId: expense.id,
        from: '2026-11-01',
        to: '2026-11-30',
        page: 2,
        pageSize: 2,
      },
      indices: [1],
      total: 3,
    },
    {
      name: 'type/category combination without matches',
      query: { type: 'INCOME', categoryId: expense.id },
      indices: [],
      total: 0,
    },
    {
      name: 'nonexistent valid category',
      query: { categoryId: randomUUID() },
      indices: [],
      total: 0,
    },
    {
      name: 'period without records',
      query: { from: '0001-01-01', to: '0001-01-01' },
      indices: [],
      total: 0,
    },
  ])(
    'filters by $name and counts exactly the same set',
    async ({ query, indices, total }) => {
      const account = await createAccount();
      const history = await createHistory(account);
      const response = await account.agent
        .get('/transactions')
        .query(query)
        .expect(200);
      const body = response.body as TransactionListResponse;
      expect(body.items.map((item) => item.id)).toEqual(
        indices.map((index) => history[index]!.id),
      );
      expect(body.total).toBe(total);
      expect(body.page).toBe(query.page ?? 1);
      expect(body.pageSize).toBe(query.pageSize ?? 20);
    },
  );

  it('rejects invalid filters, noncanonical pagination, repeated parameters and unsafe offsets', async () => {
    const account = await createAccount();
    await createHistory(account);
    const invalid: Record<string, unknown>[] = [
      { type: '' },
      { type: 'income' },
      { type: 'OTHER' },
      { type: ['INCOME', 'EXPENSE'] },
      { categoryId: '' },
      { categoryId: 'not-a-uuid' },
      { categoryId: [expense.id, income.id] },
      { from: '' },
      { from: '2026-02-29' },
      { from: '2026-04-31' },
      { from: '0000-01-01' },
      { from: '10000-01-01' },
      { from: '2026-11-12T00:00:00Z' },
      { from: '2026-11-12\n' },
      { from: ['2026-11-01', '2026-11-02'] },
      { to: '2026-13-01' },
      { to: '2026-01-00' },
      { to: ' 2026-11-12' },
      { to: '' },
      { from: '2026-11-30', to: '2026-11-01' },
      { page: '' },
      { page: '0' },
      { page: '-1' },
      { page: '1.0' },
      { page: '1.5' },
      { page: '1e2' },
      { page: '01' },
      { page: '+1' },
      { page: ' 1 ' },
      { page: '0x10' },
      { page: 'NaN' },
      { page: 'Infinity' },
      { page: '9007199254740993' },
      { page: '2147483648' },
      { page: ['1', '2'] },
      { pageSize: '' },
      { pageSize: '0' },
      { pageSize: '-1' },
      { pageSize: '101' },
      { pageSize: '1.5' },
      { pageSize: '01' },
      { pageSize: '1e2' },
      { pageSize: ['1', '2'] },
      { page: '2147483647', pageSize: '100' },
      { unknown: 'value' },
    ];
    for (const query of invalid) {
      const response = await account.agent.get('/transactions').query(query);
      expect(response.status, JSON.stringify(query)).toBe(400);
    }
    for (const query of [
      '?page[]=1',
      '?from[]=2026-11-01',
      '?type[equals]=INCOME',
    ]) {
      await account.agent.get('/transactions' + query).expect(400);
    }
    expect(
      await prisma.transaction.count({
        where: { walletId: account.wallet.id },
      }),
    ).toBe(7);
  });

  it('returns identical 404 responses for foreign and nonexistent transactions', async () => {
    const a = await createAccount();
    const b = await createAccount();
    const [transaction] = await createHistory(b);
    const foreign = await a.agent
      .get('/transactions/' + transaction!.id)
      .query({ userId: b.user.id, walletId: b.wallet.id })
      .expect(404);
    const missing = await a.agent
      .get('/transactions/' + randomUUID())
      .expect(404);
    expect(foreign.body).toEqual(missing.body);
    expect(foreign.body.message).toBe('Nie znaleziono transakcji.');
    for (const id of ['not-a-uuid', '123', '20000000-0000-4000-8000-invalid']) {
      await a.agent.get('/transactions/' + id).expect(400);
    }
    await b.agent.get('/transactions/' + transaction!.id).expect(200);
  });

  it('rejects expired and logged-out sessions for both reads', async () => {
    const expired = await createAccount();
    const loggedOut = await createAccount();
    const history = await createHistory(expired);
    await prisma.session.update({
      where: { sid: expired.sid },
      data: { expire: new Date(0) },
    });
    await loggedOut.agent.post('/auth/logout').expect(204);
    for (const { cookie } of [expired, loggedOut]) {
      await request(app.getHttpServer())
        .get('/transactions')
        .set('Cookie', cookie)
        .expect(401);
      await request(app.getHttpServer())
        .get('/transactions/' + history[0]!.id)
        .set('Cookie', cookie)
        .expect(401);
    }
  });

  it('returns an empty collection when the wallet has been removed without recreating it', async () => {
    const account = await createAccount();
    const history = await createHistory(account);
    await prisma.wallet.delete({ where: { id: account.wallet.id } });
    const response = await account.agent.get('/transactions').expect(200);
    expect(response.body).toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });
    await account.agent.get('/transactions/' + history[0]!.id).expect(404);
    expect(
      await prisma.wallet.count({ where: { userId: account.user.id } }),
    ).toBe(0);
  });

  it('keeps the global wallet balance unchanged by history filters and pagination', async () => {
    const account = await createAccount();
    await createHistory(account);
    const before = await account.agent.get('/wallet').expect(200);
    expect(before.body.balance).toBe('32.05');
    const history = await account.agent
      .get('/transactions')
      .query({
        type: 'EXPENSE',
        from: '2026-11-12',
        to: '2026-11-12',
        pageSize: 1,
      })
      .expect(200);
    expect(history.body.items).toHaveLength(1);
    expect(history.body.total).toBe(2);
    const after = await account.agent.get('/wallet').expect(200);
    expect(after.body).toEqual(before.body);
  });

  it.each(['list', 'details'] as const)(
    'sanitizes database errors during %s',
    async (operation) => {
      const account = await createAccount();
      const history = await createHistory(account);
      const detail = 'private-query-arguments-and-transaction-contents';
      const log = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});
      if (operation === 'list') {
        vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(
          new Error(detail),
        );
      } else {
        vi.spyOn(prisma.transaction, 'findFirst').mockRejectedValueOnce(
          new Error(detail),
        );
      }
      const response = await account.agent
        .get(
          operation === 'list'
            ? '/transactions'
            : '/transactions/' + history[0]!.id,
        )
        .expect(500);
      expect(response.body.message).toBe(
        operation === 'list'
          ? 'Nie udało się pobrać historii transakcji.'
          : 'Nie udało się pobrać transakcji.',
      );
      expect(log).toHaveBeenCalled();
      expect(JSON.stringify([response.body, log.mock.calls])).not.toContain(
        detail,
      );
      expect(
        await prisma.transaction.count({
          where: { walletId: account.wallet.id },
        }),
      ).toBe(7);
    },
  );
});
