import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { InvestmentPostingService } from '../src/investments/posting.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { investmentExpected as expected, investmentScenario } from './support/investment-scenario.js';

describe('Investment stage 2 acceptance (PostgreSQL)', () => {
  let prisma: PrismaService;
  let posting: InvestmentPostingService;
  const userIds: string[] = [];
  const instrumentIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    posting = new InvestmentPostingService(prisma);
  });
  afterEach(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.instrument.deleteMany({ where: { id: { in: instrumentIds } } });
    userIds.length = 0;
    instrumentIds.length = 0;
  });
  afterAll(async () => { await prisma?.$disconnect(); });

  async function setup() {
    const user = await prisma.user.create({ data: {
      email: `investment-acceptance-${randomUUID()}@example.invalid`, passwordHash: 'test-only',
    } });
    userIds.push(user.id);
    const portfolio = await prisma.portfolio.create({ data: { userId: user.id, name: 'Acceptance' } });
    const account = await prisma.investmentAccount.create({ data: { portfolioId: portfolio.id, name: 'Manual' } });
    const instrument = await prisma.instrument.create({ data: {
      ticker: `T${randomUUID().slice(0, 8)}`, mic: 'XWAR', currency: 'PLN',
    } });
    instrumentIds.push(instrument.id);
    return { userId: user.id, accountId: account.id, instrumentId: instrument.id,
      inputs: investmentScenario(account.id, instrument.id) };
  }

  it('reconciles cash, securities and FIFO at each step and after a fresh service read', async () => {
    const { userId, accountId, instrumentId, inputs } = await setup();
    await posting.postForUser(userId, inputs.deposit);
    expect((await posting.balancesForUser(userId, accountId)).cash.PLN).toBe(expected.deposited.cash);
    await posting.postForUser(userId, inputs.buy);
    expect((await posting.balancesForUser(userId, accountId)).cash.PLN).toBe(expected.bought.cash);
    expect((await posting.positionsForUser(userId, accountId)).positions[0]).toMatchObject({
      quantity: expected.bought.quantity, cost: expected.bought.cost,
    });
    const sale = await posting.postForUser(userId, inputs.sell);
    expect(await posting.postForUser(userId, inputs.sell)).toEqual({ ...sale, duplicate: true });
    const fresh = new InvestmentPostingService(prisma);
    expect(await fresh.balancesForUser(userId, accountId)).toEqual({
      cash: { PLN: expected.sold.cash, USD: '0.00' }, securities: { [instrumentId]: expected.sold.quantity },
    });
    const snapshot = await fresh.positionsForUser(userId, accountId);
    expect(snapshot.positions).toMatchObject([{ instrumentId, currency: 'PLN',
      quantity: expected.sold.quantity, cost: expected.sold.cost }]);
    expect(snapshot.sales).toMatchObject([{ eventId: sale.eventId, cost: expected.sold.soldCost,
      netProceeds: expected.sold.netProceeds, result: expected.sold.result }]);
    expect(await prisma.investmentEvent.count({ where: { accountId } })).toBe(3);
  });

  it('recalculates the reference scenario after a historical correction and retains the audit trail', async () => {
    const { userId, accountId, inputs } = await setup();
    await posting.postForUser(userId, inputs.deposit);
    const buy = await posting.postForUser(userId, inputs.buy);
    await posting.postForUser(userId, inputs.sell);
    const corrected = await posting.correctForUser(userId, {
      accountId, targetEventId: buy.eventId, expectedRevision: 0, reason: 'Cena zakupu wynosiła 55 PLN',
      idempotencyKey: 'scenario-correction', replacement: {
        ...inputs.buy, unitPrice: '55', idempotencyKey: 'scenario-correction',
      },
    });
    expect((await posting.balancesForUser(userId, accountId)).cash.PLN).toBe(expected.corrected.cash);
    const snapshot = await posting.positionsForUser(userId, accountId);
    expect(snapshot.positions[0]).toMatchObject({ quantity: expected.corrected.quantity, cost: expected.corrected.cost });
    expect(snapshot.sales[0]).toMatchObject({ cost: expected.corrected.soldCost, result: expected.corrected.result });
    expect(await prisma.investmentEvent.findUniqueOrThrow({ where: { id: buy.eventId } })).toMatchObject({ activeSlot: null });
    expect(await prisma.investmentEvent.findUniqueOrThrow({ where: { id: corrected.eventId } })).toMatchObject({
      activeSlot: 1, correctionOfId: buy.eventId, revision: 1,
    });
  });

  it('allows exactly one competing closure and reconciles the final cash and FIFO costs', async () => {
    const { userId, accountId, inputs } = await setup();
    for (const input of Object.values(inputs)) await posting.postForUser(userId, input);
    const results = await Promise.allSettled([4, 5].map((daySequence) => posting.postForUser(userId, {
      ...inputs.sell, daySequence, quantity: '6', idempotencyKey: `close-${daySequence}`,
    })));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.reason).toBeInstanceOf(ConflictException);
    expect((await posting.balancesForUser(userId, accountId)).cash.PLN).toBe(expected.closed.cash);
    const snapshot = await posting.positionsForUser(userId, accountId);
    expect(snapshot.positions).toEqual([]);
    expect(snapshot.sales.map((sale) => sale.cost)).toEqual([expected.sold.soldCost, expected.sold.cost]);
    expect(snapshot.sales[1]).toMatchObject({ netProceeds: expected.closed.netProceeds, result: expected.closed.result });
    expect(await prisma.investmentEvent.count({ where: { accountId } })).toBe(4);
  });

  it('isolates both reads and writes between two owners of the reference scenario', async () => {
    const owner = await setup();
    const stranger = await setup();
    for (const input of Object.values(owner.inputs)) await posting.postForUser(owner.userId, input);
    await expect(posting.balancesForUser(stranger.userId, owner.accountId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(posting.positionsForUser(stranger.userId, owner.accountId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(posting.postForUser(stranger.userId, owner.inputs.deposit)).rejects.toBeInstanceOf(NotFoundException);
    expect((await posting.balancesForUser(stranger.userId, stranger.accountId)).cash.PLN).toBe('0.00');
    expect((await posting.balancesForUser(owner.userId, owner.accountId)).cash.PLN).toBe(expected.sold.cash);
  });
});
