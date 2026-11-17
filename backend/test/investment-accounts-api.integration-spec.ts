import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import request from 'supertest';
import { InvestmentPostingService } from '../src/investments/posting.service.js';
import { investmentHttpContext } from './support/investment-http.js';
import { investmentExpected, investmentScenario } from './support/investment-scenario.js';

const root = '/investments/portfolios';
type Portfolio = { id: string; name: string };
type Account = Portfolio & { portfolioId: string; archivedAt: string | null };

describe('Investment portfolios and accounts HTTP API (PostgreSQL)', () => {
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
    const response = await owner.agent.post(root).set('Origin', context.origin).send({ name: '  Akcje  ' }).expect(201);
    const portfolio = response.body as Portfolio;
    const base = `${root}/${portfolio.id}/accounts`;
    const created = await owner.agent.post(base).set('Origin', context.origin).send({ name: 'Rachunek ręczny' }).expect(201);
    const account = created.body as Account;
    return { ...owner, portfolio, account, base, path: `${base}/${account.id}` };
  }

  it('requires a session for every route and rejects foreign browser writes', async () => {
    const id = randomUUID();
    const paths = [root, `${root}/${id}`, `${root}/${id}/accounts`, `${root}/${id}/accounts/${id}`];
    for (const path of paths) {
      await request(context.app.getHttpServer()).get(path).expect(401);
      const method = path === root || path.endsWith('/accounts') ? 'post' : 'patch';
      await request(context.app.getHttpServer())[method](path).set('Origin', context.origin).send({ name: 'Test' }).expect(401);
    }
    const owner = await setup();
    await owner.agent.patch(owner.path).set('Origin', 'https://foreign.invalid').send({ name: 'Changed' }).expect(403);
    expect((await owner.agent.get(owner.path).expect(200)).body.name).toBe('Rachunek ręczny');
  });

  it('creates, lists, reads and renames owned portfolios and accounts without private fields or caching', async () => {
    const owner = await setup();
    const portfolios = await owner.agent.get(root).expect(200);
    expect(portfolios.body).toHaveLength(1);
    expect(portfolios.body[0]).toEqual({ id: owner.portfolio.id, name: 'Akcje',
      createdAt: expect.any(String), updatedAt: expect.any(String) });
    expect(portfolios.headers['cache-control']).toBe('no-store');
    await owner.agent.patch(`${root}/${owner.portfolio.id}`).set('Origin', context.origin).send({ name: 'Nowy portfel' }).expect(200);
    expect((await owner.agent.get(`${root}/${owner.portfolio.id}`).expect(200)).body.name).toBe('Nowy portfel');
    const updated = await owner.agent.patch(owner.path).set('Origin', context.origin).send({ name: '  GPW i USA  ' }).expect(200);
    expect(updated.body).toMatchObject({ name: 'GPW i USA', portfolioId: owner.portfolio.id, archivedAt: null });
    const accounts = await owner.agent.get(owner.base).expect(200);
    expect(accounts.body).toEqual([updated.body]);
    expect((await owner.agent.get(owner.path).expect(200)).body).toEqual(updated.body);
  });

  it('checks the complete owner–portfolio–account relation including a wrong owned parent', async () => {
    const owner = await setup();
    const other = await setup();
    expect((await other.agent.get(root).expect(200)).body).toHaveLength(1);
    await other.agent.get(`${root}/${owner.portfolio.id}`).expect(404);
    await other.agent.patch(`${root}/${owner.portfolio.id}`).send({ name: 'Intrusion' }).expect(404);
    await other.agent.get(owner.base).expect(404);
    await other.agent.post(owner.base).send({ name: 'Intrusion' }).expect(404);
    await other.agent.get(owner.path).expect(404);
    await other.agent.patch(owner.path).send({ archived: true }).expect(404);
    const secondPortfolio = await owner.agent.post(root).send({ name: 'Drugi' }).expect(201);
    const wrongParent = `${root}/${secondPortfolio.body.id}/accounts/${owner.account.id}`;
    await owner.agent.get(wrongParent).expect(404);
    await owner.agent.patch(wrongParent).send({ name: 'Intrusion' }).expect(404);
    await owner.agent.get(`${owner.base}/${randomUUID()}`).expect(404);
    await owner.agent.get(`${root}/not-a-uuid`).expect(400);
    expect((await owner.agent.get(owner.path).expect(200)).body).toEqual(owner.account);
  });

  it.each([{}, { name: '' }, { name: '   ' }, { name: null }, { name: 12 },
    { name: 'x'.repeat(101) }, { name: 'Valid', userId: randomUUID() }, { name: 'Valid', portfolioId: randomUUID() }])(
    'rejects invalid creation DTO %j without creating anything', async (input) => {
      const owner = await setup();
      await owner.agent.post(root).send(input).expect(400);
      await owner.agent.post(owner.base).send(input).expect(400);
      expect(await context.prisma.portfolio.count({ where: { userId: owner.userId } })).toBe(1);
      expect(await context.prisma.investmentAccount.count({ where: { portfolioId: owner.portfolio.id } })).toBe(1);
    },
  );

  it.each([{}, { name: null }, { name: ' ' }, { archived: null }, { archived: 'true' }, { archived: 1 },
    { archivedAt: new Date().toISOString() }, { portfolioId: randomUUID() }])(
    'rejects invalid update DTO %j and preserves the account', async (input) => {
      const owner = await setup();
      await owner.agent.patch(owner.path).send(input).expect(400);
      expect((await owner.agent.get(owner.path).expect(200)).body).toEqual(owner.account);
    },
  );

  it('archives without losing events, keeps retries safe, blocks new writes and permits restoration', async () => {
    const owner = await setup();
    const stock = await context.prisma.instrument.create({ data: {
      ticker: `T${randomUUID().slice(0, 8)}`, mic: 'XWAR', currency: 'PLN',
    } });
    instrumentIds.push(stock.id);
    const posting = context.app.get(InvestmentPostingService);
    const inputs = investmentScenario(owner.account.id, stock.id);
    const eventIds: string[] = [];
    for (const input of Object.values(inputs)) eventIds.push((await posting.postForUser(owner.userId, input)).eventId);
    const archive = await owner.agent.patch(owner.path).send({ archived: true }).expect(200);
    expect(archive.body.archivedAt).toEqual(expect.any(String));
    const retry = await owner.agent.patch(owner.path).send({ archived: true }).expect(200);
    expect(retry.body.archivedAt).toBe(archive.body.archivedAt);
    expect((await owner.agent.get(owner.base).expect(200)).body).toHaveLength(1);
    expect((await posting.balancesForUser(owner.userId, owner.account.id)).cash.PLN).toBe(investmentExpected.sold.cash);
    expect(await posting.postForUser(owner.userId, inputs.sell)).toEqual({ eventId: eventIds[2], duplicate: true });
    await expect(posting.postForUser(owner.userId, { ...inputs.deposit, daySequence: 4, idempotencyKey: 'new' }))
      .rejects.toBeInstanceOf(ConflictException);
    await expect(posting.correctForUser(owner.userId, { accountId: owner.account.id, targetEventId: eventIds[2],
      expectedRevision: 0, reason: 'Cancel', idempotencyKey: 'cancel', replacement: null })).rejects.toBeInstanceOf(ConflictException);
    expect(await context.prisma.investmentEvent.count({ where: { accountId: owner.account.id } })).toBe(3);
    await owner.agent.patch(owner.path).send({ archived: false }).expect(200);
    await posting.postForUser(owner.userId, { ...inputs.deposit, daySequence: 4, idempotencyKey: 'new' });
    expect(await context.prisma.investmentEvent.count({ where: { accountId: owner.account.id } })).toBe(4);
  });
});
