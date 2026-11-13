import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import type {
  AnalyticsCategoriesResponse,
  AnalyticsSummaryResponse,
  AnalyticsTrendsResponse,
} from '../src/analytics/analytics-response.js';
import { seedSystemCategories } from '../src/categories/system-categories.js';
import { configureApp } from '../src/config/configure-app.js';
import { getFrontendOrigin } from '../src/config/cors.js';
import { getAuthRateLimitOptions } from '../src/config/rate-limit.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  ANALYTICS_ACCOUNT_A,
  ANALYTICS_ACCOUNT_B,
  ANALYTICS_STEPS,
  SCENARIO_PERIODS,
  scenarioDaily,
  scenarioMonthly,
  scenarioInput,
  type ScenarioAccount,
  type ScenarioExpectation,
  type ScenarioPeriod,
} from './support/analytics-scenario.js';

describe('Analytics and wallet consistency across one shared ledger (PostgreSQL)', () => {
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

  async function createAccount(scenario: ScenarioAccount) {
    const agent = request.agent(app.getHttpServer());
    const credentials = {
      email: `analytics-consistency-${randomUUID()}@example.invalid`,
      password: 'Analytics consistency test password 123!',
    };
    const registered = await agent
      .post('/auth/register')
      .send(credentials)
      .expect(201);
    const user = registered.body as { id: string };
    userIds.add(user.id);
    await agent.post('/auth/login').send(credentials).expect(200);
    const wallet = await agent
      .patch('/wallet')
      .set('Origin', origin)
      .send({ openingBalance: scenario.openingBalance })
      .expect(200);
    const entries = new Map<string, string>();
    for (const entry of scenario.entries) {
      const created = await agent
        .post('/transactions')
        .set('Origin', origin)
        .send(scenarioInput(entry))
        .expect(201);
      entries.set(entry.key, (created.body as { id: string }).id);
    }
    return {
      agent,
      user,
      walletId: (wallet.body as { id: string }).id,
      entries,
    };
  }
  type Account = Awaited<ReturnType<typeof createAccount>>;

  async function expectPeriod(
    account: Account,
    expected: ScenarioExpectation,
    name: ScenarioPeriod,
  ) {
    const range = SCENARIO_PERIODS[name];
    const fixed = expected.periods[name];
    const { income, expenses, periodResult } = fixed;
    const [summaryResponse, categoryResponse, dailyResponse, monthlyResponse] =
      await Promise.all([
        account.agent.get('/analytics/summary').query(range).expect(200),
        account.agent.get('/analytics/categories').query(range).expect(200),
        account.agent
          .get('/analytics/trends')
          .query({ ...range, granularity: 'day' })
          .expect(200),
        account.agent
          .get('/analytics/trends')
          .query({ ...range, granularity: 'month' })
          .expect(200),
      ]);
    const summary = summaryResponse.body as AnalyticsSummaryResponse;
    const categories = categoryResponse.body as AnalyticsCategoriesResponse;
    const daily = dailyResponse.body as AnalyticsTrendsResponse;
    const monthly = monthlyResponse.body as AnalyticsTrendsResponse;
    expect(summary).toEqual({
      ...range,
      currency: 'PLN',
      income,
      expenses,
      periodResult,
    });
    expect(categories).toEqual({
      ...range,
      currency: 'PLN',
      totalExpenses: expenses,
      items: fixed.categories,
    });
    expect(daily).toEqual({
      ...range,
      currency: 'PLN',
      granularity: 'day',
      items: scenarioDaily(expected, name),
    });
    expect(monthly).toEqual({
      ...range,
      currency: 'PLN',
      granularity: 'month',
      items: scenarioMonthly(expected, name),
    });
    for (const field of ['income', 'expenses', 'periodResult'] as const) {
      for (const report of [daily, monthly]) {
        expect(
          report.items
            .reduce(
              (sum, point) => sum.plus(point[field]),
              new Prisma.Decimal(0),
            )
            .toFixed(2),
        ).toBe(summary[field]);
      }
    }
    expect(
      categories.items
        .reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0))
        .toFixed(2),
    ).toBe(summary.expenses);
  }
  async function expectAccount(
    account: Account,
    expected: ScenarioExpectation,
  ) {
    const wallet = await account.agent.get('/wallet').expect(200);
    expect(wallet.body).toMatchObject({
      currency: 'PLN',
      openingBalance: expected.openingBalance,
      balance: expected.balance,
    });
    for (const period of Object.keys(SCENARIO_PERIODS) as ScenarioPeriod[])
      await expectPeriod(account, expected, period);
  }

  it('matches independent expected totals, categories, both trend series and global balances for both accounts', async () => {
    const a = await createAccount(ANALYTICS_ACCOUNT_A);
    const b = await createAccount(ANALYTICS_ACCOUNT_B);
    await expectAccount(a, ANALYTICS_ACCOUNT_A.expected);
    await expectAccount(b, ANALYTICS_ACCOUNT_B.expected);
  });

  it('keeps all reports and the second account correct after every edit and both deletion directions', async () => {
    const a = await createAccount(ANALYTICS_ACCOUNT_A);
    const b = await createAccount(ANALYTICS_ACCOUNT_B);
    for (const step of ANALYTICS_STEPS) {
      const path = '/transactions/' + a.entries.get(step.key)!;
      if (step.patch)
        await a.agent
          .patch(path)
          .set('Origin', origin)
          .send(step.patch)
          .expect(200);
      else await a.agent.delete(path).set('Origin', origin).expect(204);
      await expectAccount(a, step.expected);
      await expectAccount(b, ANALYTICS_ACCOUNT_B.expected);
    }
  }, 30000);

  it('changes only the global balance when changing the opening balance', async () => {
    const a = await createAccount(ANALYTICS_ACCOUNT_A);
    const b = await createAccount(ANALYTICS_ACCOUNT_B);
    await a.agent
      .patch('/wallet')
      .set('Origin', origin)
      .send({ openingBalance: '-200.00' })
      .expect(200);
    await expectAccount(a, {
      ...ANALYTICS_ACCOUNT_A.expected,
      openingBalance: '-200.00',
      balance: '-158.90',
    });
    await expectAccount(b, ANALYTICS_ACCOUNT_B.expected);
  });

  it('changes the global balance and matching period when an operation outside January changes', async () => {
    const a = await createAccount(ANALYTICS_ACCOUNT_A);
    const b = await createAccount(ANALYTICS_ACCOUNT_B);
    await a.agent
      .patch('/transactions/' + a.entries.get('A-grudzien')!)
      .set('Origin', origin)
      .send({ amount: '11.00' })
      .expect(200);
    const wallet = await a.agent.get('/wallet').expect(200);
    expect(wallet.body.balance).toBe('142.10');
    await expectPeriod(a, ANALYTICS_ACCOUNT_A.expected, 'january');
    await expectPeriod(a, ANALYTICS_ACCOUNT_A.expected, 'february');
    const changed = await a.agent
      .get('/analytics/summary')
      .query(SCENARIO_PERIODS.full)
      .expect(200);
    expect(changed.body).toMatchObject({
      income: '62.50',
      expenses: '20.40',
      periodResult: '42.10',
    });
    await expectAccount(b, ANALYTICS_ACCOUNT_B.expected);
  });

  it('blocks foreign reads, edits and deletions without changing either ledger or its reports', async () => {
    const a = await createAccount(ANALYTICS_ACCOUNT_A);
    const b = await createAccount(ANALYTICS_ACCOUNT_B);
    for (const [attacker, victim] of [
      [a, b],
      [b, a],
    ]) {
      for (const id of victim.entries.values()) {
        await attacker.agent.get('/transactions/' + id).expect(404);
        await attacker.agent
          .patch('/transactions/' + id)
          .set('Origin', origin)
          .send({ amount: '99.99' })
          .expect(404);
        await attacker.agent
          .delete('/transactions/' + id)
          .set('Origin', origin)
          .expect(404);
      }
      for (const path of [
        '/analytics/summary',
        '/analytics/categories',
        '/analytics/trends',
      ]) {
        await attacker.agent
          .get(path)
          .query({ ...SCENARIO_PERIODS.january, walletId: victim.walletId })
          .expect(400);
        await attacker.agent
          .get(path)
          .query({ ...SCENARIO_PERIODS.january, userId: victim.user.id })
          .expect(400);
      }
    }
    await expectAccount(a, ANALYTICS_ACCOUNT_A.expected);
    await expectAccount(b, ANALYTICS_ACCOUNT_B.expected);
  });
});
