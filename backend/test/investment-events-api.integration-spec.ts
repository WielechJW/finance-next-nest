import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { investmentHttpContext } from './support/investment-http.js';
import { investmentExpected, investmentScenario } from './support/investment-scenario.js';

describe('Investment events HTTP API (PostgreSQL)', () => {
  let context: Awaited<ReturnType<typeof investmentHttpContext>>;
  const instrumentIds: string[] = [];
  beforeAll(async () => { context = await investmentHttpContext(); });
  afterEach(async () => {
    await context.cleanup();
    await context.prisma.instrument.deleteMany({ where: { id: { in: instrumentIds } } });
    instrumentIds.length = 0;
  });
  afterAll(async () => { await context?.app.close(); });

  async function setup() {
    const owner = await context.signIn();
    const portfolio = await owner.agent.post('/investments/portfolios').send({ name: 'Akcje' }).expect(201);
    const base = `/investments/portfolios/${portfolio.body.id}/accounts`;
    const account = await owner.agent.post(base).send({ name: 'Ręczny' }).expect(201);
    const stock = await context.prisma.instrument.create({ data: {
      ticker: `T${randomUUID().slice(0, 8)}`, mic: 'XWAR', currency: 'PLN',
    } });
    instrumentIds.push(stock.id);
    const path = `${base}/${account.body.id}`;
    const scenario = investmentScenario(account.body.id as string, stock.id);
    const inputs = Object.fromEntries(Object.entries(scenario).map(([key, { accountId: _accountId, ...dto }]) => [key, dto]));
    return { ...owner, portfolioId: portfolio.body.id as string, accountId: account.body.id as string,
      stock, path, events: `${path}/events`, inputs };
  }

  async function seed(owner: Awaited<ReturnType<typeof setup>>) {
    const ids: Record<string, string> = {};
    for (const [key, input] of Object.entries(owner.inputs)) {
      const result = await owner.agent.post(owner.events).send(input).expect(201);
      ids[key] = result.body.eventId as string;
    }
    return ids;
  }

  it('requires a session and protects every event write from a foreign origin', async () => {
    const owner = await setup();
    const paths = [owner.events, `${owner.events}/${randomUUID()}`, `${owner.path}/summary`, '/investments/instruments'];
    for (const path of paths) await request(context.app.getHttpServer()).get(path).expect(401);
    await request(context.app.getHttpServer()).post(owner.events).send(owner.inputs.deposit).expect(401);
    await request(context.app.getHttpServer()).post(`${owner.events}/${randomUUID()}/corrections`).send({}).expect(401);
    await owner.agent.post(owner.events).set('Origin', 'https://foreign.invalid').send(owner.inputs.deposit).expect(403);
    expect(await context.prisma.investmentEvent.count({ where: { accountId: owner.accountId } })).toBe(0);
  });

  it('posts the acceptance scenario, reproduces retry acknowledgements, and serializes exact decimals', async () => {
    const owner = await setup();
    const ids = await seed(owner);
    const retry = await owner.agent.post(owner.events).send(owner.inputs.sell).expect(201);
    expect(retry.body).toEqual({ eventId: ids.sell, revision: 0 });
    await owner.agent.post(owner.events).send({ ...owner.inputs.sell, quantity: '3' }).expect(409);
    const detail = await owner.agent.get(`${owner.events}/${ids.buy}`).expect(200);
    expect(detail.body).toMatchObject({ id: ids.buy, type: 'BUY', occurredOn: '2026-11-10', revision: 0,
      effective: true, trade: { quantity: '10.0000000000', unitPrice: '50.0000000000', grossAmount: '500.00',
        instrument: { id: owner.stock.id, currency: 'PLN' } } });
    expect(detail.body).not.toHaveProperty('payloadHash');
    expect(detail.body).not.toHaveProperty('idempotencyKey');
    expect(detail.headers['cache-control']).toBe('no-store');
    const summary = await owner.agent.get(`${owner.path}/summary`).expect(200);
    expect(summary.body.cash).toEqual({ PLN: investmentExpected.sold.cash, USD: '0.00' });
    expect(summary.body.positions).toMatchObject([{ quantity: investmentExpected.sold.quantity, cost: investmentExpected.sold.cost }]);
    expect(summary.body.sales).toMatchObject([{ cost: investmentExpected.sold.soldCost, result: investmentExpected.sold.result }]);
    const catalog = await owner.agent.get('/investments/instruments').expect(200);
    expect(catalog.body).toContainEqual({ id: owner.stock.id, ticker: owner.stock.ticker, mic: 'XWAR', currency: 'PLN', isin: null });
    expect(await context.prisma.investmentEvent.count({ where: { accountId: owner.accountId } })).toBe(3);
  });

  it('combines inclusive filters with stable pagination, empty results and an account-wide summary', async () => {
    const owner = await setup();
    const ids = await seed(owner);
    const first = await owner.agent.get(owner.events).query({ pageSize: 2 }).expect(200);
    expect(first.body).toMatchObject({ total: 3, page: 1, pageSize: 2 });
    expect(first.body.items.map((event: { id: string }) => event.id)).toEqual([ids.sell, ids.buy]);
    const second = await owner.agent.get(owner.events).query({ page: 2, pageSize: 2 }).expect(200);
    expect(second.body.items.map((event: { id: string }) => event.id)).toEqual([ids.deposit]);
    const filtered = await owner.agent.get(owner.events).query({ type: 'BUY', instrumentId: owner.stock.id,
      from: '2026-11-10', to: '2026-11-10' }).expect(200);
    expect(filtered.body).toMatchObject({ total: 1, items: [{ id: ids.buy }] });
    expect((await owner.agent.get(owner.events).query({ from: '2026-11-11' }).expect(200)).body.total).toBe(0);
    expect((await owner.agent.get(owner.events).query({ page: 99 }).expect(200)).body.items).toEqual([]);
    expect((await owner.agent.get(`${owner.path}/summary`).expect(200)).body.cash.PLN).toBe('733.00');
  });

  it('retains corrected versions, safely retries corrections and supports cancellation with an audit view', async () => {
    const owner = await setup();
    const ids = await seed(owner);
    const correction = { expectedRevision: 0, reason: 'Cena zakupu 55 PLN', idempotencyKey: 'fix-buy',
      replacement: { ...owner.inputs.buy, idempotencyKey: 'fix-buy', unitPrice: '55' } };
    const corrected = await owner.agent.post(`${owner.events}/${ids.buy}/corrections`).send(correction).expect(201);
    expect(corrected.body.revision).toBe(1);
    const retried = await owner.agent.post(`${owner.events}/${ids.buy}/corrections`).send(correction).expect(201);
    expect(retried.body).toEqual(corrected.body);
    await owner.agent.post(`${owner.events}/${ids.buy}/corrections`).send({ ...correction,
      idempotencyKey: 'stale', replacement: { ...correction.replacement, idempotencyKey: 'stale' } }).expect(409);
    expect((await owner.agent.get(`${owner.events}/${ids.buy}`).expect(200)).body.effective).toBe(false);
    const current = await owner.agent.get(owner.events).expect(200);
    expect(current.body.total).toBe(3);
    expect(current.body.items.map((event: { id: string }) => event.id)).not.toContain(ids.buy);
    expect((await owner.agent.get(owner.events).query({ view: 'audit' }).expect(200)).body.total).toBe(4);
    const summary = await owner.agent.get(`${owner.path}/summary`).expect(200);
    expect(summary.body.cash.PLN).toBe(investmentExpected.corrected.cash);
    expect(summary.body.sales[0].result).toBe(investmentExpected.corrected.result);
    await owner.agent.post(`${owner.events}/${ids.sell}/corrections`).send({
      expectedRevision: 0, reason: 'Sprzedaż anulowana', idempotencyKey: 'cancel-sale', replacement: null,
    }).expect(201);
    const cancelled = await owner.agent.get(`${owner.path}/summary`).expect(200);
    expect(cancelled.body.cash.PLN).toBe('445.00');
    expect(cancelled.body.positions[0].quantity).toBe('10.0000000000');
    expect(cancelled.body.sales).toEqual([]);
  });

  it('checks owner, parent portfolio, account and event together for reads and corrections', async () => {
    const owner = await setup();
    const stranger = await setup();
    const ids = await seed(owner);
    for (const path of [owner.events, `${owner.events}/${ids.buy}`, `${owner.path}/summary`]) {
      await stranger.agent.get(path).expect(404);
    }
    await stranger.agent.post(owner.events).send(owner.inputs.deposit).expect(404);
    const correction = { expectedRevision: 0, reason: 'Cancel', idempotencyKey: 'intrusion', replacement: null };
    await stranger.agent.post(`${owner.events}/${ids.sell}/corrections`).send(correction).expect(404);
    await stranger.agent.get(`${stranger.events}/${ids.buy}`).expect(404);
    await stranger.agent.post(`${stranger.events}/${ids.buy}/corrections`).send(correction).expect(404);
    const wrongParent = owner.events.replace(owner.portfolioId, stranger.portfolioId);
    await owner.agent.get(wrongParent).expect(404);
    await owner.agent.post(wrongParent).send(owner.inputs.deposit).expect(404);
    await owner.agent.get(`${owner.events}/${randomUUID()}`).expect(404);
  });

  it.each([
    { amount: 12 }, { amount: '1e3' }, { amount: '1,00' }, { amount: '-1' }, { amount: '0' },
    { amount: '0.001' }, { currency: 'EUR' }, { occurredOn: '2026-02-30' }, { occurredOn: '9999-01-01' },
    { daySequence: 0 }, { daySequence: '1' }, { timePrecision: 'INSTANT' }, { executedAt: '2026-11-10T10:00:00Z' },
    { source: 'BROKER' }, { accountId: randomUUID() }, { quantity: '1' }, { idempotencyKey: ' ' },
  ])('rejects invalid operations %j without partial writes', async (changes) => {
    const owner = await setup();
    await owner.agent.post(owner.events).send({ ...owner.inputs.deposit, ...changes }).expect(400);
    expect(await context.prisma.investmentEvent.count({ where: { accountId: owner.accountId } })).toBe(0);
  });

  it('rejects missing economic fields, unknown instruments, insufficient cash and overselling', async () => {
    const owner = await setup();
    const { amount: _amount, ...missing } = owner.inputs.deposit as Record<string, unknown>;
    await owner.agent.post(owner.events).send(missing).expect(400);
    await owner.agent.post(owner.events).send(owner.inputs.buy).expect(409);
    await owner.agent.post(owner.events).send(owner.inputs.deposit).expect(201);
    await owner.agent.post(owner.events).send({ ...owner.inputs.buy, instrumentId: randomUUID() }).expect(404);
    await owner.agent.post(owner.events).send({ ...owner.inputs.buy, instrumentId: 'invalid' }).expect(400);
    await owner.agent.post(owner.events).send({ ...owner.inputs.buy, currency: 'USD' }).expect(400);
    await owner.agent.post(owner.events).send(owner.inputs.buy).expect(201);
    await owner.agent.post(owner.events).send({ ...owner.inputs.sell, quantity: '11' }).expect(409);
    expect(await context.prisma.investmentEvent.count({ where: { accountId: owner.accountId } })).toBe(2);
  });

  it('handles USD fractions, FX, dividends, fees and withdrawals through the same validated API', async () => {
    const owner = await setup();
    const usd = await context.prisma.instrument.create({ data: {
      ticker: `U${randomUUID().slice(0, 8)}`, mic: 'XNYS', currency: 'USD',
    } });
    instrumentIds.push(usd.id);
    await owner.agent.post(owner.events).send(owner.inputs.deposit).expect(201);
    const base = { occurredOn: '2026-11-10', timePrecision: 'DATE' };
    const operations = [
      { type: 'FX', soldCurrency: 'PLN', boughtCurrency: 'USD', soldAmount: '400', boughtAmount: '100', commission: '2' },
      { type: 'BUY', instrumentId: usd.id, quantity: '0.75', unitPrice: '4', commission: '0.30' },
      { type: 'SELL', instrumentId: usd.id, quantity: '0.25', unitPrice: '6' },
      { type: 'DIVIDEND', currency: 'USD', grossAmount: '10', withholdingTax: '1.50', fee: '0.50' },
      { type: 'FEE', currency: 'USD', amount: '1' },
      { type: 'WITHDRAWAL', currency: 'USD', amount: '5' },
    ];
    for (const [index, operation] of operations.entries()) {
      await owner.agent.post(owner.events).send({ ...base, ...operation, daySequence: index + 2,
        idempotencyKey: `usd-${index}` }).expect(201);
    }
    const summary = await owner.agent.get(`${owner.path}/summary`).expect(200);
    expect(summary.body.cash).toEqual({ PLN: '598.00', USD: '100.20' });
    expect(summary.body.positions[0]).toMatchObject({ currency: 'USD', quantity: '0.5000000000', cost: '2.20000000' });
    expect(summary.body.sales[0].result).toBe('0.40000000');
  });

  it.each([{ page: '0' }, { page: '1.5' }, { pageSize: 101 }, { page: 2147483647, pageSize: 100 },
    { type: 'NOPE' }, { from: '2026-02-30' }, { from: '2026-11-11', to: '2026-11-10' },
    { instrumentId: 'invalid' }, { view: 'unknown' }, { ownerId: randomUUID() }])(
    'rejects invalid history query %j', async (query) => {
      const owner = await setup();
      await owner.agent.get(owner.events).query(query).expect(400);
    },
  );

  it('serializes simultaneous retries and keeps the same acknowledgement after archiving', async () => {
    const owner = await setup();
    const results = await Promise.all([1, 2].map(() => owner.agent.post(owner.events).send(owner.inputs.deposit).expect(201)));
    expect(results[0].body).toEqual(results[1].body);
    await owner.agent.patch(owner.path).send({ archived: true }).expect(200);
    const retry = await owner.agent.post(owner.events).send(owner.inputs.deposit).expect(201);
    expect(retry.body).toEqual(results[0].body);
    await owner.agent.post(owner.events).send({ ...owner.inputs.deposit, daySequence: 2, idempotencyKey: 'new' }).expect(409);
    expect((await owner.agent.get(`${owner.path}/summary`).expect(200)).body.cash.PLN).toBe('1000.00');
    expect(await context.prisma.investmentEvent.count({ where: { accountId: owner.accountId } })).toBe(1);
  });

  it('accepts an opening position with known cost and rejects malformed nested replacements', async () => {
    const owner = await setup();
    const opening = { type: 'OPENING_POSITION', timePrecision: 'DATE', occurredOn: '2026-11-10',
      daySequence: 1, idempotencyKey: 'opening', instrumentId: owner.stock.id,
      quantity: '1.5', totalCost: '30.12345678', acquiredOn: '2025-01-01' };
    const result = await owner.agent.post(owner.events).send(opening).expect(201);
    expect((await owner.agent.get(`${owner.events}/${result.body.eventId}`).expect(200)).body.openingLot)
      .toMatchObject({ quantity: '1.5000000000', totalCost: '30.12345678', acquiredOn: '2025-01-01' });
    await owner.agent.post(`${owner.events}/${result.body.eventId}/corrections`).send({
      expectedRevision: 0, reason: 'Correction', idempotencyKey: 'fix',
      replacement: { ...opening, idempotencyKey: 'fix', quantity: 2 },
    }).expect(400);
    await owner.agent.post(`${owner.events}/${result.body.eventId}/corrections`).send({
      expectedRevision: 0, reason: 'Correction', idempotencyKey: 'fix',
      replacement: { ...opening, idempotencyKey: 'fix', accountId: randomUUID() },
    }).expect(400);
    expect((await owner.agent.get(`${owner.path}/summary`).expect(200)).body.cash.PLN).toBe('0.00');
  });

  it.each([{}, { replacement: {} }, { replacement: [] }, { expectedRevision: -1, replacement: null },
    { reason: ' ', replacement: null }, { replacement: null, ownerId: randomUUID() }])(
    'rejects invalid correction %j without changing the ledger', async (changes) => {
      const owner = await setup();
      const ids = await seed(owner);
      await owner.agent.post(`${owner.events}/${ids.buy}/corrections`).send({
        expectedRevision: 0, reason: 'Correction', idempotencyKey: 'fix', ...changes,
      }).expect(400);
      expect(await context.prisma.investmentEvent.count({ where: { accountId: owner.accountId } })).toBe(3);
    },
  );
});
