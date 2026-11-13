import { randomUUID } from 'node:crypto';
import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import type {
  AnalyticsCategoriesResponse,
  AnalyticsSummaryResponse,
} from '../src/analytics/analytics-response.js';
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

const period = { from: '2024-02-01', to: '2024-02-29' };
const food = SYSTEM_CATEGORIES[0];
const transport = SYSTEM_CATEGORIES[1];
const housing = SYSTEM_CATEGORIES[2];
const income = SYSTEM_CATEGORIES[4];
type Category = (typeof SYSTEM_CATEGORIES)[number];

describe('Analytics categories API (PostgreSQL)', () => {
  const origin = getFrontendOrigin();
  const userIds = new Set<string>();
  const categoryIds = new Set<string>();
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
    if (prisma && categoryIds.size) {
      await prisma.category.deleteMany({
        where: { id: { in: [...categoryIds] } },
      });
    }
    userIds.clear();
    categoryIds.clear();
  });

  afterAll(async () => {
    await app?.close();
  });

  async function createAccount() {
    const email = `analytics-categories-${randomUUID()}@example.invalid`;
    const password = 'Analytics categories test password 123!';
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
    entries: {
      category: { id: string; type: TransactionType };
      amount: string;
      day: string;
    }[],
  ) {
    await prisma.transaction.createMany({
      data: entries.map(({ category, amount, day }) => ({
        walletId: account.wallet.id,
        type: category.type,
        categoryId: category.id,
        amount,
        title: 'Operacja kategorii',
        occurredOn: new Date(day + 'T00:00:00.000Z'),
      })),
    });
  }

  async function addTransaction(
    account: Account,
    category: Category,
    amount: string,
  ) {
    const response = await account.agent
      .post('/transactions')
      .set('Origin', origin)
      .send({
        type: category.type,
        categoryId: category.id,
        amount,
        title: 'Wydatek do zmiany',
        occurredOn: period.from,
      })
      .expect(201);
    return response.body as TransactionResponse;
  }

  async function categories(account: Account, range = period) {
    const response = await account.agent
      .get('/analytics/categories')
      .query(range)
      .expect(200);
    return response.body as AnalyticsCategoriesResponse;
  }

  async function expectConsistent(
    account: Account,
    report: AnalyticsCategoriesResponse,
  ) {
    const response = await account.agent
      .get('/analytics/summary')
      .query({ from: report.from, to: report.to })
      .expect(200);
    const summary = response.body as AnalyticsSummaryResponse;
    expect(report.totalExpenses).toBe(summary.expenses);
    const categorySum = report.items.reduce(
      (sum, item) => sum.plus(item.amount),
      new Prisma.Decimal(0),
    );
    expect(categorySum.toFixed(2)).toBe(summary.expenses);
  }

  it('requires an active session, including after expiration and logout', async () => {
    await request(app.getHttpServer()).get('/analytics/categories').expect(401);
    const expired = await createAccount();
    const loggedOut = await createAccount();
    await prisma.session.update({
      where: { sid: expired.sid },
      data: { expire: new Date(0) },
    });
    await loggedOut.agent.post('/auth/logout').expect(204);
    for (const { cookie } of [expired, loggedOut]) {
      await request(app.getHttpServer())
        .get('/analytics/categories')
        .set('Cookie', cookie)
        .expect(401);
    }
  });

  it('returns an empty report for a new wallet, without caching or division by zero', async () => {
    const account = await createAccount();
    const response = await account.agent
      .get('/analytics/categories')
      .query(period)
      .set('Origin', origin)
      .expect(200);
    expect(response.body).toEqual({
      ...period,
      currency: 'PLN',
      totalExpenses: '0.00',
      items: [],
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['access-control-allow-origin']).toBe(origin);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    await expectConsistent(
      account,
      response.body as AnalyticsCategoriesResponse,
    );
  });

  it('groups only period expenses and matches the summary, excluding opening balance and income', async () => {
    const account = await createAccount();
    await account.agent
      .patch('/wallet')
      .set('Origin', origin)
      .send({ openingBalance: '100.00' })
      .expect(200);
    await seedEntries(account, [
      { category: food, amount: '50.00', day: period.from },
      { category: food, amount: '25.00', day: period.to },
      { category: transport, amount: '25.00', day: '2024-02-15' },
      { category: income, amount: '500.00', day: period.from },
      { category: housing, amount: '900.00', day: '2024-01-31' },
      { category: housing, amount: '800.00', day: '2024-03-01' },
    ]);
    const report = await categories(account);
    expect(report).toEqual({
      ...period,
      currency: 'PLN',
      totalExpenses: '100.00',
      items: [
        {
          categoryId: food.id,
          categoryName: food.name,
          amount: '75.00',
          percentage: '75.00',
        },
        {
          categoryId: transport.id,
          categoryName: transport.name,
          amount: '25.00',
          percentage: '25.00',
        },
      ],
    });
    await expectConsistent(account, report);
    await account.agent
      .patch('/wallet')
      .set('Origin', origin)
      .send({ openingBalance: '-200.00' })
      .expect(200);
    expect(await categories(account)).toEqual(report);
  });

  it('sorts by numeric amount descending and category ID ascending on ties', async () => {
    const account = await createAccount();
    await seedEntries(account, [
      { category: transport, amount: '2.00', day: period.from },
      { category: housing, amount: '10.00', day: period.from },
      { category: food, amount: '2.00', day: period.from },
    ]);
    const report = await categories(account);
    expect(report.totalExpenses).toBe('14.00');
    expect(report.items).toEqual([
      {
        categoryId: housing.id,
        categoryName: housing.name,
        amount: '10.00',
        percentage: '71.43',
      },
      {
        categoryId: food.id,
        categoryName: food.name,
        amount: '2.00',
        percentage: '14.29',
      },
      {
        categoryId: transport.id,
        categoryName: transport.name,
        amount: '2.00',
        percentage: '14.29',
      },
    ]);
    await expectConsistent(account, report);
  });

  it('keeps distinct categories with identical names separate', async () => {
    const account = await createAccount();
    const duplicate = await prisma.category.create({
      data: { name: food.name, type: 'EXPENSE' },
    });
    categoryIds.add(duplicate.id);
    await seedEntries(account, [
      { category: food, amount: '1.00', day: period.from },
      { category: duplicate, amount: '3.00', day: period.from },
    ]);
    const report = await categories(account);
    expect(report.items).toEqual([
      {
        categoryId: duplicate.id,
        categoryName: food.name,
        amount: '3.00',
        percentage: '75.00',
      },
      {
        categoryId: food.id,
        categoryName: food.name,
        amount: '1.00',
        percentage: '25.00',
      },
    ]);
    await expectConsistent(account, report);
  });

  it.each([
    {
      name: 'equal thirds without redistributing the rounding difference',
      amounts: ['0.01', '0.01', '0.01'],
      expected: ['33.33', '33.33', '33.33'],
      total: '0.03',
    },
    {
      name: 'halfway percentages rounded up',
      amounts: ['1.00', '31.00'],
      expected: ['3.13', '96.88'],
      total: '32.00',
    },
    {
      name: 'a small nonzero category rounded to zero percent',
      amounts: ['0.01', '999999999999.99'],
      expected: ['0.00', '100.00'],
      total: '1000000000000.00',
    },
  ])(
    'formats $name while preserving exact amounts',
    async ({ amounts, expected, total }) => {
      const account = await createAccount();
      const selected = [food, transport, housing];
      await seedEntries(
        account,
        amounts.map((amount, index) => ({
          category: selected[index]!,
          amount,
          day: period.from,
        })),
      );
      const report = await categories(account);
      expect(report.totalExpenses).toBe(total);
      expect(report.items).toHaveLength(amounts.length);
      for (const [index, amount] of amounts.entries()) {
        expect(
          report.items.find((item) => item.categoryId === selected[index]!.id),
        ).toEqual({
          categoryId: selected[index]!.id,
          categoryName: selected[index]!.name,
          amount,
          percentage: expected[index],
        });
      }
      await expectConsistent(account, report);
    },
  );

  it('preserves cents in category totals larger than the individual amount limit', async () => {
    const account = await createAccount();
    await seedEntries(account, [
      { category: food, amount: '999999999999.99', day: period.from },
      { category: food, amount: '999999999999.99', day: period.to },
      { category: transport, amount: '0.02', day: period.to },
    ]);
    const report = await categories(account);
    expect(report.totalExpenses).toBe('2000000000000.00');
    expect(report.items).toEqual([
      {
        categoryId: food.id,
        categoryName: food.name,
        amount: '1999999999999.98',
        percentage: '100.00',
      },
      {
        categoryId: transport.id,
        categoryName: transport.name,
        amount: '0.02',
        percentage: '0.00',
      },
    ]);
    await expectConsistent(account, report);
  });

  it('includes both boundaries and leap day, and supports a single-day period', async () => {
    const account = await createAccount();
    await seedEntries(account, [
      { category: housing, amount: '9.00', day: '2024-01-31' },
      { category: food, amount: '0.10', day: period.from },
      { category: transport, amount: '0.20', day: period.to },
      { category: housing, amount: '8.00', day: '2024-03-01' },
    ]);
    const report = await categories(account);
    expect(report.totalExpenses).toBe('0.30');
    expect(report.items).toEqual([
      {
        categoryId: transport.id,
        categoryName: transport.name,
        amount: '0.20',
        percentage: '66.67',
      },
      {
        categoryId: food.id,
        categoryName: food.name,
        amount: '0.10',
        percentage: '33.33',
      },
    ]);
    await expectConsistent(account, report);
    const singleDay = await categories(account, {
      from: period.to,
      to: period.to,
    });
    expect(singleDay).toEqual({
      from: period.to,
      to: period.to,
      currency: 'PLN',
      totalExpenses: '0.20',
      items: [
        {
          categoryId: transport.id,
          categoryName: transport.name,
          amount: '0.20',
          percentage: '100.00',
        },
      ],
    });
    await expectConsistent(account, singleDay);
  });

  it.each([
    { from: '2026-12-31', to: '2027-01-01' },
    { from: '0001-01-01', to: '9999-12-31' },
  ])('handles calendar boundaries $from through $to', async (range) => {
    const account = await createAccount();
    await seedEntries(account, [
      { category: food, amount: '0.10', day: range.from },
      { category: transport, amount: '0.20', day: range.to },
    ]);
    const report = await categories(account, range);
    expect(report).toMatchObject({ ...range, totalExpenses: '0.30' });
    expect(report.items.map((item) => item.amount)).toEqual(['0.20', '0.10']);
    await expectConsistent(account, report);
  });

  it('uses the same entire default Warsaw month as the summary', async () => {
    const account = await createAccount();
    // Freeze only Date so fixture creation cannot straddle a month boundary.
    vi.useFakeTimers({ toFake: ['Date'] });
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: 'Europe/Warsaw',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(new Date());
    const year = parts.find((part) => part.type === 'year')!.value;
    const month = parts.find((part) => part.type === 'month')!.value;
    const from = `${year}-${month}-01`;
    const to = `${year}-${month}-${new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate()}`;
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
      { category: food, amount: '75.00', day: from },
      { category: transport, amount: '25.00', day: to },
      { category: housing, amount: '999.00', day: previousDay },
      { category: housing, amount: '888.00', day: nextDay },
      { category: income, amount: '777.00', day: from },
    ]);
    const response = await account.agent
      .get('/analytics/categories')
      .expect(200);
    const report = response.body as AnalyticsCategoriesResponse;
    expect(report).toEqual({
      from,
      to,
      currency: 'PLN',
      totalExpenses: '100.00',
      items: [
        {
          categoryId: food.id,
          categoryName: food.name,
          amount: '75.00',
          percentage: '75.00',
        },
        {
          categoryId: transport.id,
          categoryName: transport.name,
          amount: '25.00',
          percentage: '25.00',
        },
      ],
    });
    const summary = await account.agent.get('/analytics/summary').expect(200);
    expect(summary.body).toMatchObject({
      from,
      to,
      expenses: report.totalExpenses,
    });
  });

  it.each([
    { name: 'only income', category: income, day: period.from },
    { name: 'expenses outside the period', category: food, day: '2024-03-01' },
  ])('returns no categories for $name', async ({ category, day }) => {
    const account = await createAccount();
    await seedEntries(account, [{ category, amount: '100.00', day }]);
    const report = await categories(account);
    expect(report).toEqual({
      ...period,
      currency: 'PLN',
      totalExpenses: '0.00',
      items: [],
    });
    await expectConsistent(account, report);
  });

  it('isolates accounts and rejects attempts to select a foreign wallet', async () => {
    const a = await createAccount();
    const b = await createAccount();
    await seedEntries(a, [
      { category: food, amount: '10.00', day: period.from },
    ]);
    await seedEntries(b, [
      { category: transport, amount: '90.00', day: period.from },
    ]);
    const reportA = await categories(a);
    const reportB = await categories(b);
    expect(reportA.totalExpenses).toBe('10.00');
    expect(reportA.items.map((item) => item.categoryId)).toEqual([food.id]);
    expect(reportB.totalExpenses).toBe('90.00');
    expect(reportB.items.map((item) => item.categoryId)).toEqual([
      transport.id,
    ]);
    for (const query of [{ userId: b.user.id }, { walletId: b.wallet.id }]) {
      await a.agent
        .get('/analytics/categories')
        .query({ ...period, ...query })
        .expect(400);
    }
    expect(await categories(a)).toEqual(reportA);
    expect(await categories(b)).toEqual(reportB);
    await expectConsistent(a, reportA);
    await expectConsistent(b, reportB);
  });

  it('recalculates categories after amount, category, date and type edits and deletions', async () => {
    const account = await createAccount();
    const other = await createAccount();
    const expense = await addTransaction(account, food, '20.10');
    const remaining = await addTransaction(account, transport, '9.90');
    await seedEntries(other, [
      { category: housing, amount: '88.88', day: period.from },
    ]);
    const otherReport = await categories(other);

    async function expectReport(
      total: string,
      expected: { category: Category; amount: string; percentage: string }[],
      range = period,
    ) {
      const report = await categories(account, range);
      expect(report.totalExpenses).toBe(total);
      expect(report.items).toEqual(
        expected.map(({ category, amount, percentage }) => ({
          categoryId: category.id,
          categoryName: category.name,
          amount,
          percentage,
        })),
      );
      await expectConsistent(account, report);
    }
    async function edit(input: Record<string, string>) {
      await account.agent
        .patch('/transactions/' + expense.id)
        .set('Origin', origin)
        .send(input)
        .expect(200);
    }

    await expectReport('30.00', [
      { category: food, amount: '20.10', percentage: '67.00' },
      { category: transport, amount: '9.90', percentage: '33.00' },
    ]);
    for (const method of ['patch', 'delete'] as const) {
      await other.agent[method]('/transactions/' + expense.id)
        .set('Origin', origin)
        .send(method === 'patch' ? { amount: '99.99' } : undefined)
        .expect(404);
    }
    expect((await categories(account)).totalExpenses).toBe('30.00');
    await edit({ amount: '30.10' });
    await expectReport('40.00', [
      { category: food, amount: '30.10', percentage: '75.25' },
      { category: transport, amount: '9.90', percentage: '24.75' },
    ]);
    await edit({ categoryId: transport.id });
    await expectReport('40.00', [
      { category: transport, amount: '40.00', percentage: '100.00' },
    ]);
    await edit({ occurredOn: '2024-03-01' });
    await expectReport('9.90', [
      { category: transport, amount: '9.90', percentage: '100.00' },
    ]);
    await expectReport(
      '30.10',
      [{ category: transport, amount: '30.10', percentage: '100.00' }],
      { from: '2024-03-01', to: '2024-03-31' },
    );
    await edit({
      occurredOn: period.from,
      type: 'INCOME',
      categoryId: income.id,
    });
    await expectReport('9.90', [
      { category: transport, amount: '9.90', percentage: '100.00' },
    ]);
    await expectReport('0.00', [], { from: '2024-03-01', to: '2024-03-31' });
    await edit({ type: 'EXPENSE', categoryId: food.id });
    await expectReport('40.00', [
      { category: food, amount: '30.10', percentage: '75.25' },
      { category: transport, amount: '9.90', percentage: '24.75' },
    ]);
    await account.agent
      .delete('/transactions/' + expense.id)
      .set('Origin', origin)
      .expect(204);
    await expectReport('9.90', [
      { category: transport, amount: '9.90', percentage: '100.00' },
    ]);
    await account.agent
      .delete('/transactions/' + remaining.id)
      .set('Origin', origin)
      .expect(204);
    await expectReport('0.00', []);
    expect(await categories(other)).toEqual(otherReport);
  });

  it('rejects invalid, incomplete, repeated and unknown query parameters', async () => {
    const account = await createAccount();
    const invalid: Record<string, unknown>[] = [
      { from: period.from },
      { to: period.to },
      { from: '', to: '' },
      { from: '2026-02-29', to: '2026-03-01' },
      { from: '2024-02-30', to: '2024-03-01' },
      { from: '0000-01-01', to: period.to },
      { from: period.from, to: '10000-01-01' },
      { from: '2024-02-01T00:00:00Z', to: period.to },
      { from: ' 2024-02-01', to: period.to },
      { from: period.from, to: '2024-02-29\n' },
      { from: period.to, to: period.from },
      { from: [period.from, period.from], to: period.to },
      { from: period.from, to: [period.to, period.to] },
      { ...period, type: 'EXPENSE' },
      { ...period, categoryId: food.id },
      { ...period, page: '1' },
      { ...period, unknown: 'value' },
    ];
    for (const query of invalid) {
      const response = await account.agent
        .get('/analytics/categories')
        .query(query);
      expect(response.status, JSON.stringify(query)).toBe(400);
    }
    for (const query of ['?from[]=2024-02-01', '?to[equals]=2024-02-29']) {
      await account.agent.get('/analytics/categories' + query).expect(400);
    }
  });

  it('returns 404 for a missing wallet without recreating it', async () => {
    const account = await createAccount();
    await prisma.wallet.delete({ where: { id: account.wallet.id } });
    const response = await account.agent
      .get('/analytics/categories')
      .query(period)
      .expect(404);
    expect(response.body.message).toBe('Nie znaleziono portfela.');
    expect(
      await prisma.wallet.count({ where: { userId: account.user.id } }),
    ).toBe(0);
  });

  it('sanitizes database errors in responses and logs', async () => {
    const account = await createAccount();
    const detail = 'private-query-arguments-and-transaction-contents';
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error(detail));
    const response = await account.agent
      .get('/analytics/categories')
      .query(period)
      .expect(500);
    expect(response.body.message).toBe(
      'Nie udało się pobrać wydatków według kategorii.',
    );
    expect(JSON.stringify(response.body)).not.toContain(detail);
    expect(JSON.stringify(log.mock.calls)).not.toContain(detail);
    expect(log).toHaveBeenCalledWith(
      'Nie udało się odczytać wydatków według kategorii.',
    );
  });
});
