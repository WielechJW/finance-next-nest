import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PaperExecutionService } from '../src/paper/paper-execution.service.js';
import { PaperService } from '../src/paper/paper.service.js';
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

  it('recovers the same clientOrderId after a restart and replays delayed venue executions', async () => {
    const owner = await setup();
    const outsider = await context.signIn();
    const instrument = await stock('XWAR');
    const orders = `${owner.path}/orders`;
    const create = () =>
      owner.agent
        .post(orders)
        .set('Origin', context.origin)
        .send({
          instrumentId: instrument.id,
          side: 'BUY',
          type: 'LIMIT',
          limitPrice: '50',
          quantity: '5',
          idempotencyKey: randomUUID(),
        })
        .expect(201);
    const order = await create();
    const orderId = order.body.id as string;
    const clientOrderId = order.body.clientOrderId as string;
    const post = (sub: string, input: object = {}) =>
      owner.agent
        .post(`${owner.path}/${sub}`)
        .set('Origin', context.origin)
        .send(input);
    const timedOut = await post(`orders/${orderId}/submit`, {
      fault: 'AFTER_RECEIPT',
    }).expect(201);
    expect(timedOut.body).toMatchObject({
      clientOrderId,
      state: 'UNKNOWN',
      foundAtVenue: null,
    });
    await post(`orders/${orderId}/submit`).expect(409);
    const other = await create();
    await post(`orders/${other.body.id}/submit`).expect(409);
    await outsider.agent
      .get(`${owner.path}/venue-orders/${clientOrderId}`)
      .expect(404);
    await owner.agent
      .get(`${owner.path}/venue-orders/${clientOrderId}`)
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          clientOrderId,
          found: true,
          venueState: 'ACCEPTED',
        }),
      );
    const restarted = new PaperExecutionService(
      context.prisma,
      context.app.get(PaperService),
    );
    expect(await restarted.reconcile(owner.userId, owner.id)).toMatchObject({
      matched: true,
      local: {
        available: { PLN: '750.00' },
        openOrders: [{ clientOrderId, state: 'ACCEPTED' }],
      },
    });
    const partial = {
      externalEventId: 'venue-partial',
      kind: 'FILL',
      happenedAt: new Date().toISOString(),
      fill: {
        executionId: 'venue-execution-1',
        daySequence: 3,
        quantity: '2',
        price: '49',
        fee: '1',
      },
    };
    await post(`orders/${orderId}/venue-events`, partial).expect(201);
    await post(`orders/${orderId}/venue-events`, partial).expect(201);
    await post(`orders/${other.body.id}/submit`).expect(409);
    const result = await post('reconcile').expect(201);
    expect(result.body).toMatchObject({
      matched: true,
      local: {
        cash: { PLN: '901.00' },
        available: { PLN: '751.00' },
        securities: { [instrument.id]: '2.0000000000' },
        fillIds: ['venue-execution-1'],
      },
    });
    const cancelled = {
      externalEventId: 'venue-cancel',
      kind: 'CANCELLED',
      happenedAt: new Date().toISOString(),
    };
    await post(`orders/${orderId}/venue-events`, cancelled).expect(201);
    await post('reconcile')
      .expect(201)
      .expect(({ body }) => expect(body.local.available.PLN).toBe('901.00'));
    expect(
      await context.prisma.paperVenueOrder.count({
        where: { order: { connectionId: owner.id } },
      }),
    ).toBe(1);
  });

  it('blocks an unknown submission without a receipt and reports a balance mismatch', async () => {
    const owner = await setup();
    const instrument = await stock('XNAS');
    const create = () =>
      owner.agent
        .post(`${owner.path}/orders`)
        .set('Origin', context.origin)
        .send({
          instrumentId: instrument.id,
          side: 'BUY',
          type: 'MARKET',
          quantity: '1',
          idempotencyKey: randomUUID(),
        })
        .expect(201);
    const wrong = await create();
    const post = (sub: string, input: object = {}) =>
      owner.agent
        .post(`${owner.path}/${sub}`)
        .set('Origin', context.origin)
        .send(input);
    // A direct local receipt models the difference the reconciler must detect.
    await post(`orders/${wrong.body.id}/events`, {
      externalEventId: 'local-only',
      kind: 'FILL',
      happenedAt: new Date().toISOString(),
      fill: {
        executionId: 'local-only',
        daySequence: 3,
        quantity: '1',
        price: '10',
        fee: '0',
      },
    }).expect(201);
    const mismatch = await post('reconcile').expect(201);
    expect(mismatch.body).toMatchObject({
      matched: false,
      differences: {
        cash: [{ key: 'USD', recorded: '990.00', observed: '1000.00' }],
        positions: [{ key: instrument.id }],
        fills: ['local-only'],
      },
    });
    const held = await create();
    await post(`orders/${held.body.id}/submit`).expect(409);
    const clear = await setup();
    const pending = await clear.agent
      .post(`${clear.path}/orders`)
      .set('Origin', context.origin)
      .send({
        instrumentId: instrument.id,
        side: 'BUY',
        type: 'MARKET',
        quantity: '1',
        idempotencyKey: randomUUID(),
      })
      .expect(201);
    const clearPost = (sub: string, input: object = {}) =>
      clear.agent
        .post(`${clear.path}/${sub}`)
        .set('Origin', context.origin)
        .send(input);
    await clearPost(`orders/${pending.body.id}/submit`, {
      fault: 'BEFORE_RECEIPT',
    })
      .expect(201)
      .expect(({ body }) =>
        expect(body).toMatchObject({ state: 'UNKNOWN', foundAtVenue: false }),
      );
    await clearPost('reconcile')
      .expect(201)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          matched: false,
          differences: { openOrders: [pending.body.clientOrderId] },
        }),
      );
    await clearPost(`orders/${pending.body.id}/submit`).expect(409);
    expect(
      await context.prisma.paperVenueOrder.count({
        where: { order: { connectionId: clear.id } },
      }),
    ).toBe(0);
  });
  it('keeps a simulated session expiry non-executing and books operator events exactly once', async () => {
    const owner = await setup();
    const instrument = await stock('XNAS');
    const post = (path: string, body: object) =>
      owner.agent.post(path).set('Origin', context.origin).send(body);
    const newIntent = () =>
      post(`${owner.path}/orders`, {
        instrumentId: instrument.id,
        side: 'BUY',
        type: 'LIMIT',
        quantity: '3',
        limitPrice: '60',
        idempotencyKey: randomUUID(),
      }).expect(201);
    const first = (await newIntent()).body as {
      id: string;
      clientOrderId: string;
    };
    const endpoint = `${owner.path}/orders/${first.id}`;
    await post(`${endpoint}/submit`, { fault: 'SESSION_EXPIRED' }).expect(201, {
      clientOrderId: first.clientOrderId,
      state: 'INTENT',
      sessionExpired: true,
    });
    await owner.agent
      .get(`${owner.path}/venue-orders/${first.clientOrderId}`)
      .expect(200, {
        clientOrderId: first.clientOrderId,
        found: false,
        venueState: null,
        fillIds: [],
      });
    await post(`${endpoint}/submit`, {}).expect(201, {
      clientOrderId: first.clientOrderId,
      state: 'ACCEPTED',
    });

    const execution = {
      idempotencyKey: randomUUID(),
      kind: 'FILL',
      fill: { quantity: '1', price: '50', fee: '0.5' },
    };
    await post(`${endpoint}/simulate`, {
      ...execution,
      fill: { ...execution.fill, price: '61' },
    }).expect(409);
    await Promise.all([
      post(`${endpoint}/simulate`, execution).expect(201),
      post(`${endpoint}/simulate`, execution).expect(201),
    ]);
    await post(`${endpoint}/simulate`, {
      ...execution,
      fill: { ...execution.fill, price: '49' },
    }).expect(409);
    expect(
      (await post(`${owner.path}/reconcile`, {}).expect(201)).body,
    ).toMatchObject({
      matched: true,
      local: {
        cash: { PLN: '1000.00', USD: '949.50' },
        fillIds: [`simulation:${execution.idempotencyKey}`],
      },
      venue: {
        cash: { PLN: '1000.00', USD: '949.50' },
        available: { PLN: '1000.00', USD: '829.50' },
      },
    });
    await post(`${endpoint}/simulate`, {
      kind: 'CANCELLED',
      idempotencyKey: randomUUID(),
    }).expect(201);
    await post(`${owner.path}/reconcile`, {}).expect(201);
    const second = (await newIntent()).body as { id: string };
    const next = `${owner.path}/orders/${second.id}`;
    await post(`${next}/submit`, {}).expect(201);
    await post(`${next}/simulate`, {
      kind: 'REJECTED',
      idempotencyKey: randomUUID(),
    }).expect(201);
    expect(
      (await post(`${owner.path}/reconcile`, {}).expect(201)).body,
    ).toMatchObject({
      matched: true,
      local: { available: { PLN: '1000.00', USD: '949.50' }, openOrders: [] },
    });
    const account = await owner.agent.get(owner.path).expect(200);
    expect(account.body).toMatchObject({
      reconciliationRequired: false,
      lastReconciliation: { matched: true },
      positions: [{ id: instrument.id, mic: 'XNAS', quantity: '1.0000000000' }],
      orders: [
        { state: 'REJECTED', fills: [] },
        { state: 'CANCELLED', fills: [{ quantity: '1.0000000000' }] },
      ],
    });
  });
});
