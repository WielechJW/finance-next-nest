import { randomUUID } from 'node:crypto';
import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import type {
  AnalyticsSummaryResponse,
  AnalyticsTrendsResponse,
} from '../src/analytics/analytics-response.js';
import type { AnalyticsGranularity } from '../src/analytics/analytics-trends.js';
import {
  seedSystemCategories,
  SYSTEM_CATEGORIES,
} from '../src/categories/system-categories.js';
import { configureApp } from '../src/config/configure-app.js';
import { getFrontendOrigin } from '../src/config/cors.js';
import { getAuthRateLimitOptions } from '../src/config/rate-limit.js';
import {
  Prisma,
  type TransactionType,
} from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import type { TransactionResponse } from '../src/transactions/transaction-response.js';
import { setCookieHeaders } from './support/cookies.js';

const period = { from: '2024-02-28', to: '2024-03-02' };
type TrendsQuery = {
  from: string;
  to: string;
  granularity?: AnalyticsGranularity;
};
const zero = { income: '0.00', expenses: '0.00', periodResult: '0.00' };

describe('Analytics trends API (PostgreSQL)', () => {
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
    const email = `analytics-trends-${randomUUID()}@example.invalid`;
    const password = 'Analytics trends test password 123!';
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
        amount,
        categoryId: SYSTEM_CATEGORIES.find(
          (category) => category.type === type,
        )!.id,
        title: 'Operacja trendu',
        occurredOn: new Date(day + 'T00:00:00.000Z'),
      })),
    });
  }

  async function trends(account: Account, query: TrendsQuery = period) {
    const response = await account.agent
      .get('/analytics/trends')
      .query(query)
      .expect(200);
    return response.body as AnalyticsTrendsResponse;
  }

  async function expectConsistent(
    account: Account,
    report: AnalyticsTrendsResponse,
  ) {
    const response = await account.agent
      .get('/analytics/summary')
      .query({ from: report.from, to: report.to })
      .expect(200);
    const summary = response.body as AnalyticsSummaryResponse;
    for (const field of ['income', 'expenses', 'periodResult'] as const) {
      const sum = report.items.reduce(
        (total, point) => total.plus(point[field]),
        new Prisma.Decimal(0),
      );
      expect(sum.toFixed(2)).toBe(summary[field]);
    }
  }

  it('requires an active session, including after expiration and logout', async () => {
    await request(app.getHttpServer()).get('/analytics/trends').expect(401);
    const expired = await createAccount();
    const loggedOut = await createAccount();
    await prisma.session.update({
      where: { sid: expired.sid },
      data: { expire: new Date(0) },
    });
    await loggedOut.agent.post('/auth/logout').expect(204);
    for (const { cookie } of [expired, loggedOut]) {
      await request(app.getHttpServer())
        .get('/analytics/trends')
        .set('Cookie', cookie)
        .expect(401);
    }
  });

  it.each([
    {
      granularity: 'day',
      labels: ['2024-02-28', '2024-02-29', '2024-03-01', '2024-03-02'],
    },
    { granularity: 'month', labels: ['2024-02', '2024-03'] },
  ] as const)(
    'returns all zero $granularity points for an empty wallet and excludes opening balance',
    async ({ granularity, labels }) => {
      const account = await createAccount();
      const response = await account.agent
        .get('/analytics/trends')
        .query({ ...period, granularity })
        .set('Origin', origin)
        .expect(200);
      const expected = {
        ...period,
        currency: 'PLN',
        granularity,
        items: labels.map((label) => ({ period: label, ...zero })),
      };
      expect(response.body).toEqual(expected);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['access-control-allow-origin']).toBe(origin);
      expect(response.headers['access-control-allow-credentials']).toBe('true');
      await account.agent
        .patch('/wallet')
        .set('Origin', origin)
        .send({ openingBalance: '100.00' })
        .expect(200);
      await seedEntries(account, [
        { type: 'INCOME', amount: '999.00', day: '2024-03-03' },
      ]);
      const report = await trends(account, { ...period, granularity });
      expect(report).toEqual(expected);
      await expectConsistent(account, report);
    },
  );

  it('returns exact chronological daily sums with leap day, inclusive boundaries and a zero gap', async () => {
    const account = await createAccount();
    await seedEntries(account, [
      { type: 'INCOME', amount: '9.00', day: '2024-02-27' },
      { type: 'INCOME', amount: '0.10', day: '2024-02-28' },
      { type: 'EXPENSE', amount: '0.01', day: '2024-02-28' },
      { type: 'INCOME', amount: '0.10', day: '2024-02-29' },
      { type: 'INCOME', amount: '0.10', day: '2024-02-29' },
      { type: 'EXPENSE', amount: '0.02', day: '2024-02-29' },
      { type: 'EXPENSE', amount: '0.10', day: '2024-03-02' },
      { type: 'INCOME', amount: '50.00', day: '2024-03-03' },
    ]);
    const report = await trends(account);
    expect(report).toEqual({
      ...period,
      currency: 'PLN',
      granularity: 'day',
      items: [
        {
          period: '2024-02-28',
          income: '0.10',
          expenses: '0.01',
          periodResult: '0.09',
        },
        {
          period: '2024-02-29',
          income: '0.20',
          expenses: '0.02',
          periodResult: '0.18',
        },
        { period: '2024-03-01', ...zero },
        {
          period: '2024-03-02',
          income: '0.00',
          expenses: '0.10',
          periodResult: '-0.10',
        },
      ],
    });
    await expectConsistent(account, report);
    const singleDay = await trends(account, {
      from: '2024-02-29',
      to: '2024-02-29',
    });
    expect(singleDay.items).toEqual([
      {
        period: '2024-02-29',
        income: '0.20',
        expenses: '0.02',
        periodResult: '0.18',
      },
    ]);
    await expectConsistent(account, singleDay);
  });

  it('clips partial months to the filter and fills empty months across the year boundary', async () => {
    const account = await createAccount();
    const range = {
      from: '2026-11-15',
      to: '2027-02-10',
      granularity: 'month',
    } as const;
    await seedEntries(account, [
      { type: 'INCOME', amount: '100.00', day: '2026-11-14' },
      { type: 'INCOME', amount: '50.20', day: '2026-11-15' },
      { type: 'EXPENSE', amount: '20.10', day: '2026-11-30' },
      { type: 'EXPENSE', amount: '0.20', day: '2026-12-01' },
      { type: 'INCOME', amount: '0.30', day: '2026-12-31' },
      { type: 'EXPENSE', amount: '0.01', day: '2027-02-01' },
      { type: 'INCOME', amount: '0.02', day: '2027-02-10' },
      { type: 'INCOME', amount: '99.00', day: '2027-02-11' },
    ]);
    const report = await trends(account, range);
    expect(report).toEqual({
      ...range,
      currency: 'PLN',
      items: [
        {
          period: '2026-11',
          income: '50.20',
          expenses: '20.10',
          periodResult: '30.10',
        },
        {
          period: '2026-12',
          income: '0.30',
          expenses: '0.20',
          periodResult: '0.10',
        },
        { period: '2027-01', ...zero },
        {
          period: '2027-02',
          income: '0.02',
          expenses: '0.01',
          periodResult: '0.01',
        },
      ],
    });
    await expectConsistent(account, report);
  });

  it('starts monthly buckets at the first day even when the filter starts on January 31', async () => {
    const account = await createAccount();
    await seedEntries(account, [
      { type: 'INCOME', amount: '1.00', day: '2024-01-31' },
      { type: 'EXPENSE', amount: '0.10', day: '2024-02-29' },
      { type: 'INCOME', amount: '0.20', day: '2024-03-01' },
    ]);
    const report = await trends(account, {
      from: '2024-01-31',
      to: '2024-03-01',
      granularity: 'month',
    });
    expect(report.items).toEqual([
      {
        period: '2024-01',
        income: '1.00',
        expenses: '0.00',
        periodResult: '1.00',
      },
      {
        period: '2024-02',
        income: '0.00',
        expenses: '0.10',
        periodResult: '-0.10',
      },
      {
        period: '2024-03',
        income: '0.20',
        expenses: '0.00',
        periodResult: '0.20',
      },
    ]);
    await expectConsistent(account, report);
  });

  it.each([
    ['2026-03-28', '2026-03-29', '2026-03-30'],
    ['2026-10-24', '2026-10-25', '2026-10-26'],
    ['2026-12-31', '2027-01-01', '2027-01-02'],
    ['0001-01-01', '0001-01-02', '0001-01-03'],
    ['9999-12-29', '9999-12-30', '9999-12-31'],
  ])(
    'preserves three calendar days %s, %s, %s without skips or date shifts',
    async (from, middle, to) => {
      const account = await createAccount();
      await seedEntries(account, [
        { type: 'INCOME', amount: '0.10', day: from },
        { type: 'EXPENSE', amount: '0.20', day: to },
      ]);
      const report = await trends(account, { from, to });
      expect(report.items).toEqual([
        {
          period: from,
          income: '0.10',
          expenses: '0.00',
          periodResult: '0.10',
        },
        { period: middle, ...zero },
        { period: to, income: '0.00', expenses: '0.20', periodResult: '-0.20' },
      ]);
      await expectConsistent(account, report);
    },
  );

  it.each([
    { from: '0001-01-01', to: '0001-02-28', labels: ['0001-01', '0001-02'] },
    { from: '9999-11-01', to: '9999-12-31', labels: ['9999-11', '9999-12'] },
  ])(
    'supports monthly calendar bounds $from through $to',
    async ({ from, to, labels }) => {
      const account = await createAccount();
      await seedEntries(account, [{ type: 'INCOME', amount: '0.10', day: to }]);
      const report = await trends(account, { from, to, granularity: 'month' });
      expect(report.items).toEqual([
        { period: labels[0], ...zero },
        {
          period: labels[1],
          income: '0.10',
          expenses: '0.00',
          periodResult: '0.10',
        },
      ]);
      await expectConsistent(account, report);
    },
  );

  it.each(['day', 'month'] as const)(
    'preserves large exact amounts and a negative result by %s',
    async (granularity) => {
      const account = await createAccount();
      await seedEntries(account, [
        { type: 'INCOME', amount: '999999999999.99', day: period.from },
        { type: 'INCOME', amount: '999999999999.99', day: period.from },
        { type: 'EXPENSE', amount: '0.01', day: period.from },
        { type: 'EXPENSE', amount: '0.10', day: period.to },
      ]);
      const report = await trends(account, { ...period, granularity });
      expect(report.items[0]).toEqual({
        period: granularity === 'day' ? period.from : '2024-02',
        income: '1999999999999.98',
        expenses: '0.01',
        periodResult: '1999999999999.97',
      });
      expect(report.items.at(-1)).toMatchObject({
        income: '0.00',
        expenses: '0.10',
        periodResult: '-0.10',
      });
      await expectConsistent(account, report);
    },
  );

  it('defaults to a complete daily series for the current Warsaw month', async () => {
    const account = await createAccount();
    vi.useFakeTimers({ toFake: ['Date'] });
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: 'Europe/Warsaw',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(new Date());
    const year = parts.find((part) => part.type === 'year')!.value;
    const month = parts.find((part) => part.type === 'month')!.value;
    const days = new Date(
      Date.UTC(Number(year), Number(month), 0),
    ).getUTCDate();
    const from = `${year}-${month}-01`;
    const to = `${year}-${month}-${days}`;
    await seedEntries(account, [
      { type: 'INCOME', amount: '50.20', day: from },
      { type: 'EXPENSE', amount: '20.10', day: to },
      {
        type: 'INCOME',
        amount: '999.00',
        day: new Date(new Date(to + 'T00:00:00.000Z').getTime() + 86_400_000)
          .toISOString()
          .slice(0, 10),
      },
    ]);
    const response = await account.agent.get('/analytics/trends').expect(200);
    const report = response.body as AnalyticsTrendsResponse;
    expect(report).toMatchObject({
      from,
      to,
      currency: 'PLN',
      granularity: 'day',
    });
    expect(report.items).toEqual(
      Array.from({ length: days }, (_, index) => ({
        period: `${year}-${month}-${String(index + 1).padStart(2, '0')}`,
        income: index === 0 ? '50.20' : '0.00',
        expenses: index === days - 1 ? '20.10' : '0.00',
        periodResult:
          index === 0 ? '50.20' : index === days - 1 ? '-20.10' : '0.00',
      })),
    );
    await expectConsistent(account, report);
    const monthly = await account.agent
      .get('/analytics/trends')
      .query({ granularity: 'month' })
      .expect(200);
    expect(monthly.body).toEqual({
      from,
      to,
      currency: 'PLN',
      granularity: 'month',
      items: [
        {
          period: `${year}-${month}`,
          income: '50.20',
          expenses: '20.10',
          periodResult: '30.10',
        },
      ],
    });
  });

  it.each([
    {
      from: '2024-01-01',
      to: '2024-12-31',
      granularity: 'day',
      count: 366,
      first: '2024-01-01',
      last: '2024-12-31',
    },
    {
      from: '2020-01-31',
      to: '2029-12-01',
      granularity: 'month',
      count: 120,
      first: '2020-01',
      last: '2029-12',
    },
  ] as const)(
    'accepts exactly $count $granularity points',
    async ({ from, to, granularity, count, first, last }) => {
      const account = await createAccount();
      const report = await trends(account, { from, to, granularity });
      expect(report.items).toHaveLength(count);
      expect(report.items[0]?.period).toBe(first);
      expect(report.items.at(-1)?.period).toBe(last);
      expect(new Set(report.items.map((point) => point.period)).size).toBe(
        count,
      );
      expect(report.items.map((point) => point.period)).toEqual(
        report.items.map((point) => point.period).toSorted(),
      );
      expect(
        report.items.every(
          (point) =>
            point.income === '0.00' &&
            point.expenses === '0.00' &&
            point.periodResult === '0.00',
        ),
      ).toBe(true);
    },
  );

  it('rejects excessive ranges before querying and leaves other reports unrestricted', async () => {
    const account = await createAccount();
    const query = vi.spyOn(prisma, '$queryRaw');
    for (const range of [
      { from: '2024-01-01', to: '2025-01-01', granularity: 'day' },
      { from: '2020-01-31', to: '2030-01-01', granularity: 'month' },
      { from: '0001-01-01', to: '9999-12-31', granularity: 'day' },
      { from: '0001-01-01', to: '9999-12-31', granularity: 'month' },
    ]) {
      await account.agent.get('/analytics/trends').query(range).expect(400);
    }
    expect(query).not.toHaveBeenCalled();
    for (const path of ['/analytics/summary', '/analytics/categories']) {
      await account.agent
        .get(path)
        .query({ from: '0001-01-01', to: '9999-12-31' })
        .expect(200);
    }
  });

  it('isolates accounts and rejects attempts to select a foreign owner', async () => {
    const a = await createAccount();
    const b = await createAccount();
    await seedEntries(a, [
      { type: 'INCOME', amount: '10.10', day: period.from },
    ]);
    await seedEntries(b, [
      { type: 'EXPENSE', amount: '90.90', day: period.to },
    ]);
    for (const granularity of ['day', 'month'] as const) {
      const reportA = await trends(a, { ...period, granularity });
      const reportB = await trends(b, { ...period, granularity });
      expect(reportA.items[0]).toMatchObject({
        income: '10.10',
        expenses: '0.00',
      });
      expect(reportA.items.at(-1)).toMatchObject(zero);
      expect(reportB.items[0]).toMatchObject(zero);
      expect(reportB.items.at(-1)).toMatchObject({
        income: '0.00',
        expenses: '90.90',
      });
      await expectConsistent(a, reportA);
      await expectConsistent(b, reportB);
    }
    for (const query of [{ userId: b.user.id }, { walletId: b.wallet.id }]) {
      await a.agent
        .get('/analytics/trends')
        .query({ ...period, ...query })
        .expect(400);
    }
  });

  it('reflects amount, date and type edits and deletions in both granularities', async () => {
    const account = await createAccount();
    const other = await createAccount();
    await seedEntries(other, [
      { type: 'INCOME', amount: '88.88', day: period.from },
    ]);
    const otherBefore = await trends(other);
    await account.agent
      .patch('/wallet')
      .set('Origin', origin)
      .send({ openingBalance: '100.00' })
      .expect(200);
    const created = await account.agent
      .post('/transactions')
      .set('Origin', origin)
      .send({
        type: 'EXPENSE',
        categoryId: SYSTEM_CATEGORIES[0].id,
        amount: '20.10',
        title: 'Zmienny trend',
        occurredOn: period.from,
      })
      .expect(201);
    const transaction = created.body as TransactionResponse;
    await seedEntries(account, [
      { type: 'INCOME', amount: '50.20', day: period.from },
    ]);

    async function check(
      first: { income: string; expenses: string; periodResult: string },
      last = zero,
    ) {
      for (const granularity of ['day', 'month'] as const) {
        const report = await trends(account, { ...period, granularity });
        expect(report.items[0]).toMatchObject(first);
        expect(report.items.at(-1)).toMatchObject(last);
        await expectConsistent(account, report);
      }
    }
    async function edit(input: Record<string, string>) {
      await account.agent
        .patch('/transactions/' + transaction.id)
        .set('Origin', origin)
        .send(input)
        .expect(200);
    }
    await check({ income: '50.20', expenses: '20.10', periodResult: '30.10' });
    for (const method of ['patch', 'delete'] as const) {
      await other.agent[method]('/transactions/' + transaction.id)
        .set('Origin', origin)
        .send(method === 'patch' ? { amount: '99.99' } : undefined)
        .expect(404);
    }
    await edit({ amount: '30.10' });
    await check({ income: '50.20', expenses: '30.10', periodResult: '20.10' });
    await edit({ occurredOn: period.to });
    await check(
      { income: '50.20', expenses: '0.00', periodResult: '50.20' },
      { income: '0.00', expenses: '30.10', periodResult: '-30.10' },
    );
    await edit({ occurredOn: '2024-03-03' });
    await check({ income: '50.20', expenses: '0.00', periodResult: '50.20' });
    await edit({
      occurredOn: period.from,
      type: 'INCOME',
      categoryId: SYSTEM_CATEGORIES[4].id,
    });
    await check({ income: '80.30', expenses: '0.00', periodResult: '80.30' });
    await edit({ type: 'EXPENSE', categoryId: SYSTEM_CATEGORIES[0].id });
    await account.agent
      .delete('/transactions/' + transaction.id)
      .set('Origin', origin)
      .expect(204);
    await check({ income: '50.20', expenses: '0.00', periodResult: '50.20' });
    expect(await trends(other)).toEqual(otherBefore);
  });

  it('rejects invalid, incomplete, repeated and unknown parameters', async () => {
    const account = await createAccount();
    for (const query of [
      { from: period.from },
      { to: period.to },
      { from: '', to: '' },
      { from: '2026-02-29', to: '2026-03-01' },
      { from: '0000-01-01', to: period.to },
      { from: period.from, to: '10000-01-01' },
      { from: '2024-02-28T00:00:00Z', to: period.to },
      { from: period.to, to: period.from },
      { from: [period.from, period.from], to: period.to },
      { from: period.from, to: [period.to, period.to] },
      { ...period, granularity: '' },
      { ...period, granularity: 'DAY' },
      { ...period, granularity: 'year' },
      { ...period, granularity: ' month' },
      { ...period, granularity: ['day', 'month'] },
      { ...period, granularity: ['day', 'day'] },
      { ...period, type: 'INCOME' },
      { ...period, categoryId: SYSTEM_CATEGORIES[0].id },
      { ...period, page: '1' },
      { ...period, unknown: 'value' },
    ]) {
      const response = await account.agent
        .get('/analytics/trends')
        .query(query);
      expect(response.status, JSON.stringify(query)).toBe(400);
    }
    for (const query of [
      '?granularity[]=day',
      '?granularity[equals]=day',
      '?from[]=2024-02-28',
    ]) {
      await account.agent.get('/analytics/trends' + query).expect(400);
    }
  });

  it('returns 404 for a removed wallet without recreating it', async () => {
    const account = await createAccount();
    await prisma.wallet.delete({ where: { id: account.wallet.id } });
    const response = await account.agent
      .get('/analytics/trends')
      .query(period)
      .expect(404);
    expect(response.body.message).toBe('Nie znaleziono portfela.');
    expect(
      await prisma.wallet.count({ where: { userId: account.user.id } }),
    ).toBe(0);
  });

  it('sanitizes database errors in both responses and logs', async () => {
    const account = await createAccount();
    const detail = 'private-query-arguments-and-transaction-contents';
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error(detail));
    const response = await account.agent
      .get('/analytics/trends')
      .query(period)
      .expect(500);
    expect(response.body.message).toBe(
      'Nie udało się pobrać trendów analityki.',
    );
    expect(JSON.stringify(response.body)).not.toContain(detail);
    expect(JSON.stringify(log.mock.calls)).not.toContain(detail);
    expect(log).toHaveBeenCalledWith(
      'Nie udało się odczytać trendów analityki.',
    );
  });
});
