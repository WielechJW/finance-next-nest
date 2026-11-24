import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { investmentHttpContext } from './support/investment-http.js';

const root = '/investment-paper/connections';

describe('Local paper order ledger (PostgreSQL)', () => {
  let context: Awaited<ReturnType<typeof investmentHttpContext>>;
  const instruments: string[] = [];
  beforeAll(async () => {
    context = await investmentHttpContext();
  });
  afterEach(async () => {
    await context.cleanup();
    await context.prisma.instrument.deleteMany({
      where: { id: { in: instruments } },
    });
    instruments.length = 0;
  });
  afterAll(async () => {
    await context?.app.close();
  });

  async function stock(mic: 'XWAR' | 'XNAS') {
    const row = await context.prisma.instrument.create({
      data: {
        ticker: 'P' + randomUUID().slice(0, 8),
        mic,
        currency: mic === 'XWAR' ? 'PLN' : 'USD',
      },
    });
    instruments.push(row.id);
    return row;
  }

  async function setup() {
    const owner = await context.signIn();
    const input = {
      name: 'Rachunek paper',
      idempotencyKey: randomUUID(),
      openingOn: '2026-07-06',
      cash: { PLN: '1000', USD: '1000' },
    };
    const open = () =>
      owner.agent
        .post(root)
        .set('Origin', context.origin)
        .send(input)
        .expect(201);
    const [first, retry] = await Promise.all([open(), open()]);
    expect(retry.body).toEqual(first.body);
    const id = first.body.id as string;
    return { ...owner, id, path: `${root}/${id}` };
  }

  it('posts each fill once and keeps final state when acknowledgements arrive late', async () => {
    const owner = await setup();
    const other = await context.signIn();
    const instrument = await stock('XWAR');
    await request(context.app.getHttpServer()).get(owner.path).expect(401);
    await other.agent.get(owner.path).expect(404);
    await owner.agent.get('/investments/portfolios').expect(200, []);
    const requestBody = {
      instrumentId: instrument.id,
      side: 'BUY',
      type: 'LIMIT',
      limitPrice: '50',
      quantity: '5',
      idempotencyKey: randomUUID(),
    };
    const orders = `${owner.path}/orders`;
    const create = () =>
      owner.agent
        .post(orders)
        .set('Origin', context.origin)
        .send(requestBody)
        .expect(201);
    const [created, repeated] = await Promise.all([create(), create()]);
    expect(created.body).toMatchObject({
      state: 'INTENT',
      clientOrderId: repeated.body.clientOrderId,
      filledQuantity: '0.0000000000',
    });
    const orderId = created.body.id as string;
    const endpoint = `${orders}/${orderId}/events`;
    const event = (body: object) =>
      owner.agent.post(endpoint).set('Origin', context.origin).send(body);
    const lateExecution = {
      externalEventId: 'fill-2',
      kind: 'FILL',
      happenedAt: '2026-07-07T12:01:00Z',
      fill: {
        executionId: 'execution-2',
        daySequence: 4,
        quantity: '2',
        price: '50',
        fee: '1',
      },
    };
    const earlyExecution = {
      externalEventId: 'fill-1',
      kind: 'FILL',
      happenedAt: '2026-07-07T12:00:00Z',
      fill: {
        executionId: 'execution-1',
        daySequence: 3,
        quantity: '3',
        price: '49',
        fee: '0',
      },
    };
    const [partial1, partial2] = await Promise.all([
      event(lateExecution).expect(201),
      event(lateExecution).expect(201),
    ]);
    expect(partial1.body).toEqual(partial2.body);
    expect(partial1.body).toMatchObject({
      state: 'PARTIALLY_FILLED',
      filledQuantity: '2.0000000000',
    });
    await event(earlyExecution).expect(201);
    await event({
      ...earlyExecution,
      externalEventId: 'repeat-feed-notice',
    }).expect(201);
    await event({
      ...earlyExecution,
      externalEventId: 'conflict',
      fill: { ...earlyExecution.fill, price: '48' },
    }).expect(409);
    const accepted = await event({
      externalEventId: 'accepted',
      kind: 'ACCEPTED',
      happenedAt: '2026-07-07T11:55:00Z',
    }).expect(201);
    expect(accepted.body).toMatchObject({
      state: 'FILLED',
      filledQuantity: '5.0000000000',
      fills: [{ executionId: 'execution-1' }, { executionId: 'execution-2' }],
    });
    const detail = await owner.agent
      .get(owner.path)
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(detail.body).toMatchObject({
      mode: 'LOCAL_PAPER',
      balances: {
        cash: { PLN: '752.00', USD: '1000.00' },
        securities: { [instrument.id]: '5.0000000000' },
      },
    });
    const ledger = await context.prisma.brokerConnection.findUniqueOrThrow({
      where: { id: owner.id },
    });
    expect(
      await context.prisma.investmentEvent.count({
        where: { accountId: ledger.accountId, source: 'BROKER' },
      }),
    ).toBe(2);
  });

  it('records a cancelled US order with its partial fill and rejects a later fill or bad limit', async () => {
    const owner = await setup();
    const instrument = await stock('XNAS');
    const orders = `${owner.path}/orders`;
    const create = (order: object) =>
      owner.agent.post(orders).set('Origin', context.origin).send(order);
    const intent = {
      instrumentId: instrument.id,
      side: 'BUY',
      type: 'LIMIT',
      limitPrice: '100',
      quantity: '3',
      idempotencyKey: randomUUID(),
    };
    await create({ ...intent, type: 'MARKET' }).expect(400);
    const order = await create(intent).expect(201);
    const event = (body: object) =>
      owner.agent
        .post(`${orders}/${order.body.id}/events`)
        .set('Origin', context.origin)
        .send(body);
    await event({
      externalEventId: 'cancel',
      kind: 'CANCELLED',
      happenedAt: '2026-07-07T16:30:00Z',
    }).expect(201);
    const execution = {
      externalEventId: 'fill',
      kind: 'FILL',
      happenedAt: '2026-07-07T16:00:00Z',
      fill: {
        executionId: 'us-fill',
        daySequence: 3,
        quantity: '1',
        price: '100',
        fee: '1',
      },
    };
    await event({ ...execution, happenedAt: '2026-07-07T17:00:00Z' }).expect(
      409,
    );
    await event({
      ...execution,
      fill: { ...execution.fill, price: '101' },
    }).expect(409);
    const filled = await event(execution).expect(201);
    expect(filled.body).toMatchObject({
      state: 'CANCELLED',
      filledQuantity: '1.0000000000',
    });
    const detail = await owner.agent.get(owner.path).expect(200);
    expect(detail.body.balances.cash).toEqual({
      USD: '899.00',
      PLN: '1000.00',
    });
  });
});
