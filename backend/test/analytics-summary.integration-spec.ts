import { randomUUID } from 'node:crypto';
import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import type { AnalyticsSummaryResponse } from '../src/analytics/analytics-response.js';
import {
  seedSystemCategories,
  SYSTEM_CATEGORIES,
} from '../src/categories/system-categories.js';
import { configureApp } from '../src/config/configure-app.js';
import { getFrontendOrigin } from '../src/config/cors.js';
import { getAuthRateLimitOptions } from '../src/config/rate-limit.js';
import type { TransactionType } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import type { TransactionResponse } from '../src/transactions/transaction-response.js';
import { setCookieHeaders } from './support/cookies.js';

const period = { from: '2024-02-01', to: '2024-02-29' };

describe('Analytics summary API (PostgreSQL)', () => {
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
    vi.useRealTimers();
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
    const email = `analytics-summary-${randomUUID()}@example.invalid`;
    const password = 'Analytics summary test password 123!';
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

  type Account = Awaited<ReturnType<typeof createAccount>>;

  async function seedEntries(
    account: Account,
    entries: { type: TransactionType; amount: string; day: string }[],
  ) {
    await prisma.transaction.createMany({
      data: entries.map(({ type, amount, day }) => ({
        walletId: account.wallet.id,
        type,
        categoryId: SYSTEM_CATEGORIES.find(
          (category) => category.type === type,
        )!.id,
        amount,
        title: 'Operacja raportu',
        occurredOn: new Date(day + 'T00:00:00.000Z'),
      })),
    });
  }

  async function summary(account: Account, range = period) {
    const response = await account.agent
      .get('/analytics/summary')
      .query(range)
      .expect(200);
    return response.body as AnalyticsSummaryResponse;
  }

  it('requires an active session, including after expiration and logout', async () => {
    await request(app.getHttpServer()).get('/analytics/summary').expect(401);
    const expired = await createAccount();
    const loggedOut = await createAccount();
    await prisma.session.update({
      where: { sid: expired.sid },
      data: { expire: new Date(0) },
    });
    await loggedOut.agent.post('/auth/logout').expect(204);
    for (const { cookie } of [expired, loggedOut]) {
      await request(app.getHttpServer())
        .get('/analytics/summary')
        .set('Cookie', cookie)
        .expect(401);
    }
  });

  it('returns zero amounts for a new wallet and disables caching', async () => {
    const account = await createAccount();
    const response = await account.agent
      .get('/analytics/summary')
      .query(period)
      .set('Origin', origin)
      .expect(200);
    expect(response.body).toEqual({
      ...period,
      currency: 'PLN',
      income: '0.00',
      expenses: '0.00',
      periodResult: '0.00',
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['access-control-allow-origin']).toBe(origin);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('defaults to the entire current Warsaw month, including future days', async () => {
    const account = await createAccount();
    // Keep fixture dates and the HTTP request in the same month at midnight.
    vi.useFakeTimers({ toFake: ['Date'] });
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: 'Europe/Warsaw',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(new Date());
    const year = parts.find((part) => part.type === 'year')!.value;
    const month = parts.find((part) => part.type === 'month')!.value;
    const lastDay = new Date(
      Date.UTC(Number(year), Number(month), 0),
    ).getUTCDate();
    const from = `${year}-${month}-01`;
    const to = `${year}-${month}-${lastDay}`;
    const previousDay = new Date(
      new Date(from + 'T00:00:00.000Z').getTime() - 86_400_000,
    )
      .toISOString()
      .slice(0, 10);
    const nextDay = new Date(
      new Date(to + 'T00:00:00.000Z').getTime() + 86_400_000,
    )
      .toISOString()
      .slice(0, 10);
    await seedEntries(account, [
      { type: 'INCOME', amount: '50.20', day: from },
      { type: 'EXPENSE', amount: '20.10', day: to },
      { type: 'INCOME', amount: '999.00', day: previousDay },
      { type: 'EXPENSE', amount: '888.00', day: nextDay },
    ]);
    const response = await account.agent.get('/analytics/summary').expect(200);
    expect(response.body).toEqual({
      from,
      to,
      currency: 'PLN',
      income: '50.20',
      expenses: '20.10',
      periodResult: '30.10',
    });
  });

  it('includes both calendar boundaries and leap day, excluding adjacent dates', async () => {
    const account = await createAccount();
    await seedEntries(account, [
      { type: 'INCOME', amount: '7.00', day: '2024-01-31' },
      { type: 'INCOME', amount: '0.10', day: period.from },
      { type: 'EXPENSE', amount: '0.01', day: '2024-02-15' },
      { type: 'INCOME', amount: '0.20', day: period.to },
      { type: 'EXPENSE', amount: '9.00', day: '2024-03-01' },
    ]);
    expect(await summary(account)).toEqual({
      ...period,
      currency: 'PLN',
      income: '0.30',
      expenses: '0.01',
      periodResult: '0.29',
    });
    expect(await summary(account, { from: period.to, to: period.to })).toEqual({
      from: period.to,
      to: period.to,
      currency: 'PLN',
      income: '0.20',
      expenses: '0.00',
      periodResult: '0.20',
    });
  });

  it.each(['INCOME', 'EXPENSE'] as const)(
    'handles a history with only %s and returns zeros for an empty period',
    async (type) => {
      const account = await createAccount();
      await seedEntries(account, [
        { type, amount: '0.10', day: period.from },
        { type, amount: '0.20', day: period.to },
      ]);
      expect(await summary(account)).toEqual({
        ...period,
        currency: 'PLN',
        income: type === 'INCOME' ? '0.30' : '0.00',
        expenses: type === 'EXPENSE' ? '0.30' : '0.00',
        periodResult: type === 'INCOME' ? '0.30' : '-0.30',
      });
      expect(
        await summary(account, { from: '2024-03-01', to: '2024-03-31' }),
      ).toEqual({
        from: '2024-03-01',
        to: '2024-03-31',
        currency: 'PLN',
        income: '0.00',
        expenses: '0.00',
        periodResult: '0.00',
      });
    },
  );

  it('keeps a mixed negative result exact', async () => {
    const account = await createAccount();
    await seedEntries(account, [
      { type: 'INCOME', amount: '0.10', day: period.from },
      { type: 'EXPENSE', amount: '0.30', day: period.to },
    ]);
    expect(await summary(account)).toMatchObject({
      income: '0.10',
      expenses: '0.30',
      periodResult: '-0.20',
    });
  });

  it('preserves cents when totals exceed the per-transaction amount limit', async () => {
    const account = await createAccount();
    await seedEntries(account, [
      { type: 'INCOME', amount: '999999999999.99', day: period.from },
      { type: 'INCOME', amount: '999999999999.99', day: period.to },
      { type: 'EXPENSE', amount: '0.01', day: period.to },
    ]);
    expect(await summary(account)).toMatchObject({
      income: '1999999999999.98',
      expenses: '0.01',
      periodResult: '1999999999999.97',
    });
  });

  it('supports the full calendar range without shifting dates through time zones', async () => {
    const account = await createAccount();
    await seedEntries(account, [
      { type: 'INCOME', amount: '0.10', day: '0001-01-01' },
      { type: 'EXPENSE', amount: '0.01', day: '9999-12-31' },
    ]);
    expect(
      await summary(account, { from: '0001-01-01', to: '9999-12-31' }),
    ).toMatchObject({ income: '0.10', expenses: '0.01', periodResult: '0.09' });
    for (const [day, income, expenses, periodResult] of [
      ['0001-01-01', '0.10', '0.00', '0.10'],
      ['9999-12-31', '0.00', '0.01', '-0.01'],
    ] as const) {
      expect(await summary(account, { from: day, to: day })).toEqual({
        from: day,
        to: day,
        currency: 'PLN',
        income,
        expenses,
        periodResult,
      });
    }
  });

  it('keeps the period result independent of opening balance and other periods', async () => {
    const account = await createAccount();
    await account.agent
      .patch('/wallet')
      .set('Origin', origin)
      .send({ openingBalance: '100.00' })
      .expect(200);
    await seedEntries(account, [
      { type: 'INCOME', amount: '50.20', day: period.from },
      { type: 'EXPENSE', amount: '20.10', day: period.to },
    ]);
    const expected = await summary(account);
    expect(expected).toEqual({
      ...period,
      currency: 'PLN',
      income: '50.20',
      expenses: '20.10',
      periodResult: '30.10',
    });
    const wallet = await account.agent.get('/wallet').expect(200);
    expect(wallet.body.openingBalance).toBe('100.00');
    expect(wallet.body.balance).toBe('130.10');

    await account.agent
      .patch('/wallet')
      .set('Origin', origin)
      .send({ openingBalance: '-200.00' })
      .expect(200);
    await seedEntries(account, [
      { type: 'INCOME', amount: '10.00', day: '2024-03-01' },
    ]);
    expect(await summary(account)).toEqual(expected);
    const changed = await account.agent.get('/wallet').expect(200);
    expect(changed.body.balance).toBe('-159.90');
  });

  it('isolates accounts and rejects attempts to select another owner', async () => {
    const a = await createAccount();
    const b = await createAccount();
    await seedEntries(a, [
      { type: 'INCOME', amount: '50.20', day: period.from },
      { type: 'EXPENSE', amount: '20.10', day: period.to },
    ]);
    await seedEntries(b, [
      { type: 'EXPENSE', amount: '90.30', day: period.from },
    ]);
    const expectedA = await summary(a);
    const expectedB = await summary(b);
    expect(expectedA).toMatchObject({
      income: '50.20',
      expenses: '20.10',
      periodResult: '30.10',
    });
    expect(expectedB).toMatchObject({
      income: '0.00',
      expenses: '90.30',
      periodResult: '-90.30',
    });
    for (const query of [{ userId: b.user.id }, { walletId: b.wallet.id }]) {
      await a.agent
        .get('/analytics/summary')
        .query({ ...period, ...query })
        .expect(400);
    }
    expect(await summary(a)).toEqual(expectedA);
    expect(await summary(b)).toEqual(expectedB);
  });

  it('reflects edits, movement between periods, and deletion in subsequent reads', async () => {
    const account = await createAccount();
    const b = await createAccount();
    await seedEntries(b, [
      { type: 'INCOME', amount: '888.88', day: period.from },
    ]);
    const otherSummary = await summary(b);
    const createExpense = await account.agent
      .post('/transactions')
      .set('Origin', origin)
      .send({
        type: 'EXPENSE',
        categoryId: SYSTEM_CATEGORIES[0].id,
        amount: '20.10',
        title: 'Wydatek analityki',
        occurredOn: period.to,
      })
      .expect(201);
    const expense = createExpense.body as TransactionResponse;
    await seedEntries(account, [
      { type: 'INCOME', amount: '50.20', day: period.from },
    ]);
    expect(await summary(account)).toMatchObject({
      income: '50.20',
      expenses: '20.10',
      periodResult: '30.10',
    });

    for (const method of ['patch', 'delete'] as const) {
      await b.agent[method]('/transactions/' + expense.id)
        .set('Origin', origin)
        .send(method === 'patch' ? { amount: '99.99' } : undefined)
        .expect(404);
    }
    expect(await summary(account)).toMatchObject({ periodResult: '30.10' });
    await account.agent
      .patch('/transactions/' + expense.id)
      .set('Origin', origin)
      .send({ amount: '30.10' })
      .expect(200);
    expect(await summary(account)).toMatchObject({
      income: '50.20',
      expenses: '30.10',
      periodResult: '20.10',
    });

    await account.agent
      .patch('/transactions/' + expense.id)
      .set('Origin', origin)
      .send({ occurredOn: '2024-03-01' })
      .expect(200);
    expect(await summary(account)).toMatchObject({
      expenses: '0.00',
      periodResult: '50.20',
    });
    expect(
      await summary(account, { from: '2024-03-01', to: '2024-03-31' }),
    ).toMatchObject({
      income: '0.00',
      expenses: '30.10',
      periodResult: '-30.10',
    });

    await account.agent
      .patch('/transactions/' + expense.id)
      .set('Origin', origin)
      .send({ occurredOn: period.to })
      .expect(200);
    await account.agent
      .patch('/transactions/' + expense.id)
      .set('Origin', origin)
      .send({
        type: 'INCOME',
        categoryId: SYSTEM_CATEGORIES.find(
          (category) => category.type === 'INCOME',
        )!.id,
      })
      .expect(200);
    expect(await summary(account)).toMatchObject({
      income: '80.30',
      expenses: '0.00',
      periodResult: '80.30',
    });
    await account.agent
      .delete('/transactions/' + expense.id)
      .set('Origin', origin)
      .expect(204);
    expect(await summary(account)).toMatchObject({
      income: '50.20',
      expenses: '0.00',
      periodResult: '50.20',
    });
    expect(await summary(b)).toEqual(otherSummary);
  });

  it('rejects invalid, incomplete, repeated and unknown query parameters', async () => {
    const account = await createAccount();
    const invalid: Record<string, unknown>[] = [
      { from: period.from },
      { to: period.to },
      { from: '' },
      { to: '' },
      { from: '', to: '' },
      { from: '2026-02-29', to: '2026-03-01' },
      { from: '2024-02-30', to: '2024-03-01' },
      { from: '0000-01-01', to: period.to },
      { from: period.from, to: '10000-01-01' },
      { from: period.from, to: '2024-13-01' },
      { from: period.from, to: '2024-02-00' },
      { from: period.from, to: '2024-04-31' },
      { from: '2024-2-01', to: period.to },
      { from: '2024-02-01T00:00:00Z', to: period.to },
      { from: ' 2024-02-01', to: period.to },
      { from: period.from, to: '2024-02-29\n' },
      { from: period.to, to: period.from },
      { from: [period.from, period.from], to: period.to },
      { from: period.from, to: [period.to, period.to] },
      { ...period, type: 'INCOME' },
      { ...period, unknown: 'value' },
    ];
    for (const query of invalid) {
      const response = await account.agent
        .get('/analytics/summary')
        .query(query);
      expect(response.status, JSON.stringify(query)).toBe(400);
    }
    for (const query of ['?from[]=2024-02-01', '?to[equals]=2024-02-29']) {
      await account.agent.get('/analytics/summary' + query).expect(400);
    }
  });

  it('returns 404 for a removed wallet without recreating it', async () => {
    const account = await createAccount();
    await prisma.wallet.delete({ where: { id: account.wallet.id } });
    const response = await account.agent
      .get('/analytics/summary')
      .query(period)
      .expect(404);
    expect(response.body.message).toBe('Nie znaleziono portfela.');
    expect(
      await prisma.wallet.count({ where: { userId: account.user.id } }),
    ).toBe(0);
  });

  it('sanitizes database errors in both the response and logs', async () => {
    const account = await createAccount();
    const detail = 'private-query-arguments-and-transaction-contents';
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error(detail));
    const response = await account.agent
      .get('/analytics/summary')
      .query(period)
      .expect(500);
    expect(response.body.message).toBe(
      'Nie udało się pobrać podsumowania analityki.',
    );
    expect(JSON.stringify(response.body)).not.toContain(detail);
    expect(JSON.stringify(log.mock.calls)).not.toContain(detail);
    expect(log).toHaveBeenCalledWith(
      'Nie udało się odczytać podsumowania analityki.',
    );
  });
});
