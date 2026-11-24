import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { TelegramClient } from '../src/notifications/telegram.client.js';
import { StrategyRunnerService } from '../src/strategies/strategy-runner.service.js';
import { investmentHttpContext } from './support/investment-http.js';

const parameters = { fastSessions: 2, slowSessions: 3, validForMinutes: 30 };
const decidedAt = '2026-07-09T22:00:00.000Z';
const prices = [
  ['2026-07-06', '120'],
  ['2026-07-07', '85'],
  ['2026-07-08', '95'],
  ['2026-07-09', '125'],
];

describe('Investment strategy versions and runs (PostgreSQL)', () => {
  let context: Awaited<ReturnType<typeof investmentHttpContext>>;
  const instruments: string[] = [];
  const jobs: string[] = [];
  beforeAll(async () => {
    context = await investmentHttpContext();
  });
  afterEach(async () => {
    await context.cleanup();
    await context.prisma.priceBar.deleteMany({
      where: { instrumentId: { in: instruments } },
    });
    await context.prisma.instrument.deleteMany({
      where: { id: { in: instruments } },
    });
    instruments.length = 0;
    await context.prisma.marketJob.deleteMany({ where: { key: { in: jobs } } });
    jobs.length = 0;
  });
  afterAll(async () => {
    await context?.app.close();
  });

  async function setup() {
    const owner = await context.signIn();
    const portfolio = await owner.agent
      .post('/investments/portfolios')
      .send({ name: 'Portfel sygnałów' })
      .expect(201);
    const accounts = `/investments/portfolios/${portfolio.body.id}/accounts`;
    const account = await owner.agent
      .post(accounts)
      .send({ name: 'Rachunek sygnałów' })
      .expect(201);
    const accountId = account.body.id as string;
    const instrument = await context.prisma.instrument.create({
      data: {
        ticker: 'S' + randomUUID().slice(0, 8),
        mic: 'XNAS',
        currency: 'USD',
      },
    });
    instruments.push(instrument.id);
    const path = `${accounts}/${accountId}`;
    return {
      ...owner,
      instrument,
      path,
      root: `${path}/strategies`,
      accountId,
    };
  }

  it('keeps parameters and data immutable, deduplicates a saved decision, and replays without future revisions', async () => {
    const { agent, instrument, root, path, accountId } = await setup();
    const external = await setup();
    const create = (values: object = parameters) =>
      agent.post(root).set('Origin', context.origin).send({
        name: 'Reguła testowa',
        instrumentId: instrument.id,
        parameters: values,
      });
    await create({ ...parameters, unverified: true }).expect(400);
    const registration = await create().expect(201);
    expect(registration.body).toMatchObject({
      enabled: false,
      versions: [{ number: 1, codeVersion: '1', parameters }],
    });
    const strategy = `${root}/${registration.body.id}`;
    await request(context.app.getHttpServer())
      .get(`${strategy}/runs`)
      .expect(401);
    await external.agent.get(root).expect(404);
    await external.agent
      .post(`${strategy}/runs`)
      .set('Origin', context.origin)
      .send({ decidedAt })
      .expect(404);
    await agent.get(`${strategy}/runs`).expect(200, []);

    const deposited = await agent
      .post(`${path}/events`)
      .set('Origin', context.origin)
      .send({
        type: 'DEPOSIT',
        currency: 'USD',
        amount: '100',
        occurredOn: '2026-07-06',
        timePrecision: 'DATE',
        daySequence: 1,
        idempotencyKey: 'signal-deposit',
      })
      .expect(201);
    await context.prisma.investmentEvent.update({
      where: { id: deposited.body.eventId },
      data: { recordedAt: new Date('2026-07-06T17:00:00Z') },
    });
    const saved = await Promise.all(
      prices.map(([on, close]) =>
        context.prisma.priceBar.create({
          data: {
            instrumentId: instrument.id,
            source: 'EODHD',
            sessionOn: new Date(on),
            open: close,
            high: close,
            low: close,
            close,
            adjustedClose: close,
            volume: '100',
            contentHash: on.padEnd(64, '0'),
            fetchedAt: new Date(on + 'T21:45:00Z'),
          },
        }),
      ),
    );
    const run = () =>
      agent
        .post(`${strategy}/runs`)
        .set('Origin', context.origin)
        .send({ decidedAt })
        .expect(201);
    const [first, duplicate] = await Promise.all([run(), run()]);
    expect(first.body).toEqual(duplicate.body);
    expect(first.body).toMatchObject({
      decision: {
        kind: 'SIGNAL',
        side: 'BUY',
        evidence: { barIds: saved.map((bar) => bar.id).reverse() },
      },
      signal: {
        instrumentId: instrument.id,
        side: 'BUY',
        validUntil: '2026-07-09T22:30:00.000Z',
      },
      input: {
        portfolio: { cash: '100.00', quantity: '0.0000000000' },
        eventIds: [deposited.body.eventId],
      },
    });
    await context.prisma.priceBar.update({
      where: { id: saved[3].id },
      data: { currentSlot: null },
    });
    await context.prisma.priceBar.create({
      data: {
        instrumentId: instrument.id,
        source: 'EODHD',
        sessionOn: new Date('2026-07-09'),
        open: '1',
        high: '1',
        low: '1',
        close: '1',
        adjustedClose: '1',
        volume: '100',
        contentHash: 'f'.repeat(64),
        revision: 2,
        fetchedAt: new Date('2026-07-09T22:03:00Z'),
      },
    });
    const changed = { ...parameters, validForMinutes: 45 };
    const revisions = `${strategy}/versions`;
    await agent
      .post(revisions)
      .set('Origin', context.origin)
      .send({ parameters: changed })
      .expect(201)
      .expect(({ body }) => expect(body.number).toBe(2));
    await agent
      .post(revisions)
      .set('Origin', context.origin)
      .send({ parameters: changed })
      .expect(201)
      .expect(({ body }) => expect(body.number).toBe(2));
    const versionList = await agent.get(revisions).expect(200);
    expect(versionList.body).toMatchObject([
      { number: 2, parameters: changed },
      { number: 1, parameters },
    ]);
    const second = await run();
    expect(second.body).toMatchObject({
      version: { number: 2 },
      decision: { evidence: first.body.decision.evidence },
      signal: { validUntil: '2026-07-09T22:45:00.000Z' },
    });
    const replay = `${strategy}/runs/${first.body.id}/replay`;
    await external.agent.get(replay).expect(404);
    const replayed = await agent
      .get(replay)
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(replayed.body).toMatchObject({
      run: { version: { number: 1 }, input: first.body.input },
      computed: first.body.decision,
    });
    await agent
      .get(`${strategy}/runs?page=2&pageSize=1`)
      .expect(200)
      .expect(({ body }) => expect(body).toHaveLength(1));
    expect(
      await context.prisma.investmentEvent.count({ where: { accountId } }),
    ).toBe(1);
  });

  async function scheduledFixture(linked: boolean) {
    const owner = await setup();
    const { agent, instrument, root, path, userId } = owner;
    const registration = await agent
      .post(root)
      .set('Origin', context.origin)
      .send({
        name: 'Strategia harmonogramu',
        instrumentId: instrument.id,
        parameters,
      })
      .expect(201);
    const id = registration.body.id as string;
    const versionId = registration.body.versions[0].id as string;
    const day = '2026-07-09';
    const enable = (enabled: boolean) =>
      agent
        .patch(`${root}/${id}/schedule`)
        .set('Origin', context.origin)
        .send({ enabled, notifyOnSignal: true })
        .expect(200);
    await enable(true);
    const deposit = await agent
      .post(`${path}/events`)
      .set('Origin', context.origin)
      .send({
        type: 'DEPOSIT',
        currency: 'USD',
        amount: '50',
        occurredOn: '2026-07-06',
        timePrecision: 'DATE',
        daySequence: 1,
        idempotencyKey: 'scheduler-cash',
      })
      .expect(201);
    await context.prisma.investmentEvent.update({
      where: { id: deposit.body.eventId },
      data: { recordedAt: new Date('2026-07-06T15:00:00Z') },
    });
    if (linked)
      await context.prisma.telegramConnection.create({
        data: {
          userId,
          chatId: '1234' + String(jobs.length),
          quietStart: 0,
          quietEnd: 0,
        },
      });
    jobs.push(`strategy_${versionId}_${day}`, `split-fixture_${id}`);
    const price = (index: number) => {
      const [on, close] = prices[index];
      return context.prisma.priceBar.create({
        data: {
          instrumentId: instrument.id,
          source: 'EODHD',
          sessionOn: new Date(on),
          open: close,
          high: close,
          low: close,
          close,
          adjustedClose: close,
          volume: '100',
          contentHash: on.padEnd(64, '0'),
          fetchedAt: new Date(on + 'T21:45:00Z'),
        },
      });
    };
    const cover = () =>
      context.prisma.marketJob.create({
        data: {
          key: `split-fixture_${id}`,
          kind: 'splits',
          status: 'SUCCEEDED',
          payload: { instrumentId: instrument.id, from: '2026-03-01', to: day },
        },
      });
    const runner = context.app.get(StrategyRunnerService);
    const now = new Date(decidedAt);
    return { ...owner, id, versionId, day, now, enable, price, cover, runner };
  }

  it('waits for the last close and split data, and a pair of workers records one signal', async () => {
    const {
      agent,
      id,
      versionId,
      day,
      now,
      runner,
      price,
      cover,
      userId,
      root,
      enable,
    } = await scheduledFixture(false);
    await Promise.all([runner.schedule(now), runner.schedule(now)]);
    expect(
      await context.prisma.marketJob.count({
        where: { key: `strategy_${versionId}_${day}` },
      }),
    ).toBe(1);
    await Promise.all([price(0), price(1), price(2)]);
    await cover();
    expect(await runner.execute(id, versionId, day, now)).toEqual({
      retryAt: new Date('2026-07-09T22:05:00.000Z'),
    });
    await agent.get(`${root}/${id}/runs`).expect(200, []);
    await price(3);
    const [first, second] = await Promise.all([
      runner.execute(id, versionId, day, now),
      runner.execute(id, versionId, day, now),
    ]);
    expect(first).toEqual(second);
    const runs = await agent.get(`${root}/${id}/runs`).expect(200);
    expect(runs.body).toMatchObject([
      { decision: { kind: 'SIGNAL', side: 'BUY' } },
    ]);
    const notifications = await context.prisma.notification.findMany({
      where: { userId },
    });
    expect(notifications).toMatchObject([
      { state: 'CANCELLED', kind: 'SIGNAL', lastError: 'disconnected' },
    ]);
    await enable(false);
    expect(
      await runner.execute(
        id,
        versionId,
        '2026-07-10',
        new Date('2026-07-10T22:00:00Z'),
      ),
    ).toEqual({ skipped: 'inactive' });
  });

  it('queues one notification, uses the existing retry path, and reports expired market-data jobs', async () => {
    const {
      runner,
      id,
      versionId,
      day,
      now,
      price,
      cover,
      userId,
      root,
      agent,
    } = await scheduledFixture(true);
    await Promise.all([price(0), price(1), price(2), price(3)]);
    expect(await runner.execute(id, versionId, day, now)).toEqual({
      retryAt: new Date('2026-07-09T22:05:00.000Z'),
    });
    await cover();
    await runner.execute(id, versionId, day, now);
    const signal = await context.prisma.notification.findFirstOrThrow({
      where: { userId, kind: 'SIGNAL' },
    });
    jobs.push(`signal_notification_${signal.signalId}`);
    expect(
      (
        await context.prisma.marketJob.findUnique({
          where: { key: `signal_notification_${signal.signalId}` },
        })
      )?.payload,
    ).toMatchObject({ notificationId: signal.id });
    const telegram = context.app.get(TelegramClient);
    const enabled = vi.spyOn(telegram, 'enabled').mockReturnValue(true);
    const send = vi
      .spyOn(telegram, 'send')
      .mockResolvedValueOnce({
        state: 'RETRY',
        code: 'rate_limit',
        retryAfter: 10,
      })
      .mockResolvedValueOnce({ state: 'SENT', messageId: '1' });
    try {
      const deliver = context.app.get(NotificationsService);
      expect(await deliver.deliver(signal.id, now)).toEqual({
        retryAt: new Date('2026-07-09T22:00:10.000Z'),
      });
      await deliver.deliver(signal.id, new Date('2026-07-09T22:00:11Z'));
      expect(send).toHaveBeenCalledTimes(2);
      expect(
        await context.prisma.notification.findUnique({
          where: { id: signal.id },
        }),
      ).toMatchObject({ state: 'SENT', attempts: 2 });
    } finally {
      enabled.mockRestore();
      send.mockRestore();
    }
    await runner.execute(
      id,
      versionId,
      '2026-07-10',
      new Date('2026-07-13T22:00:00Z'),
    );
    const rows = await agent.get(`${root}/${id}/runs`).expect(200);
    expect(rows.body[0]).toMatchObject({
      decision: { kind: 'NO_SIGNAL', reason: 'MARKET_DATA_TIMEOUT' },
    });
  });

  it('stores a complete report and failed trial, and freezes a non-overlapping test version', async () => {
    const owner = await setup();
    const other = await setup();
    const registered = await owner.agent
      .post(owner.root)
      .set('Origin', context.origin)
      .send({
        name: 'Test historyczny',
        instrumentId: owner.instrument.id,
        parameters,
      })
      .expect(201);
    const strategy = `${owner.root}/${registered.body.id}`;
    const endpoint = `${strategy}/backtests`;
    const example = JSON.parse(
      readFileSync(
        new URL(
          '../../frontend/public/examples/backtest-snapshot.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as Record<string, unknown>;
    const send = (data: object) =>
      owner.agent
        .post(endpoint)
        .set('Origin', context.origin)
        .attach('snapshot', Buffer.from(JSON.stringify(data)), 'snapshot.json');
    await send({ ...example, unknown: true }).expect(400);
    const trained = await send(example)
      .expect(201)
      .expect('Cache-Control', 'no-store');
    expect(trained.body).toMatchObject({
      status: 'COMPLETE',
      phase: 'DEVELOPMENT',
      version: { number: 1 },
      report: {
        strategy: {
          initialCapital: '1000.00000000',
          finalCapital: '938.00000000',
          profit: '-62.00000000',
          maxDrawdownPercent: '7.8585',
          turnover: '260.00000000',
          executedTrades: 1,
          curve: [
            { capital: '1000.00000000' },
            { capital: '1018.00000000' },
            { capital: '938.00000000' },
          ],
        },
        benchmark: {
          key: 'same-instrument-buy-and-hold',
          finalCapital: '938.00000000',
          executedTrades: 1,
        },
        costs: { commissionFixed: '2' },
        assumptions: { fillPrice: 'NEXT_OPEN' },
      },
    });
    await other.agent.get(endpoint).expect(404);
    await other.agent.get(`${endpoint}/${trained.body.id}`).expect(404);
    const failed = await send({ ...example, sessions: [] }).expect(201);
    expect(failed.body).toMatchObject({
      status: 'FAILED',
      report: null,
      error: expect.stringContaining('wszystkie sesje'),
    });
    const outOfSample = {
      ...example,
      phase: 'OUT_OF_SAMPLE',
      baselineId: trained.body.id,
    };
    await send(outOfSample).expect(400);
    await owner.agent
      .post(`${strategy}/versions`)
      .set('Origin', context.origin)
      .send({ parameters: { ...parameters, validForMinutes: 45 } })
      .expect(201);
    const tested = await send({
      ...outOfSample,
      fromOn: '2026-07-14',
      toOn: '2026-07-14',
      sessions: [
        {
          sessionOn: '2026-07-14',
          decidedAt: '2026-07-14T22:00:00Z',
          opening: null,
        },
      ],
    }).expect(201);
    expect(tested.body).toMatchObject({
      status: 'COMPLETE',
      phase: 'OUT_OF_SAMPLE',
      version: { number: 1 },
      baselineId: trained.body.id,
      report: { strategy: { executedTrades: 0 } },
    });
    const history = await owner.agent.get(endpoint).expect(200);
    expect(history.body.map((row: { status: string }) => row.status)).toEqual([
      'COMPLETE',
      'FAILED',
      'COMPLETE',
    ]);
    await owner.agent
      .get(`${endpoint}/${trained.body.id}`)
      .expect(200, trained.body);
  });
});
