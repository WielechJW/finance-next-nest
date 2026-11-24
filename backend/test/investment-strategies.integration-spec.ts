import { randomUUID } from 'node:crypto';
import request from 'supertest';
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
      agent
        .post(root)
        .set('Origin', context.origin)
        .send({
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
});
