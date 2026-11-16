import { randomUUID } from 'node:crypto';
import { InvestmentPostingService } from '../src/investments/posting.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Investment FIFO (PostgreSQL)', () => {
  let prisma: PrismaService;
  let posting: InvestmentPostingService;
  const emails = new Set<string>();
  const instrumentIds = new Set<string>();

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    posting = new InvestmentPostingService(prisma);
  });
  afterEach(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [...emails] } } });
    await prisma.instrument.deleteMany({ where: { id: { in: [...instrumentIds] } } });
    emails.clear();
    instrumentIds.clear();
  });
  afterAll(async () => { await prisma?.$disconnect(); });

  async function account() {
    const email = `fifo-${randomUUID()}@example.invalid`;
    emails.add(email);
    const user = await prisma.user.create({ data: { email, passwordHash: 'test-hash' } });
    const portfolio = await prisma.portfolio.create({ data: { userId: user.id, name: 'FIFO' } });
    const investmentAccount = await prisma.investmentAccount.create({
      data: { portfolioId: portfolio.id, name: 'Broker' },
    });
    return { userId: user.id, accountId: investmentAccount.id };
  }
  async function instrument(ticker: string, mic: string, currency: 'PLN' | 'USD') {
    const value = await prisma.instrument.create({ data: { ticker, mic, currency } });
    instrumentIds.add(value.id);
    return value;
  }
  function base(accountId: string, daySequence: number, idempotencyKey: string) {
    return { accountId, daySequence, idempotencyKey, occurredOn: '2026-11-10', timePrecision: 'DATE' as const };
  }

  it('allocates acquisition commissions across FIFO lots and closes the position exactly', async () => {
    const owner = await account();
    const stock = await instrument('CDR', 'XWAR', 'PLN');
    await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 1, 'deposit'), type: 'DEPOSIT', currency: 'PLN', amount: '1000',
    });
    const firstBuy = await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 2, 'buy-1'), type: 'BUY', instrumentId: stock.id,
      quantity: '3', unitPrice: '0.33', commission: '0.01',
    });
    const secondBuy = await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 3, 'buy-2'), type: 'BUY', instrumentId: stock.id,
      quantity: '2', unitPrice: '10', commission: '2',
    });
    const firstSale = await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 4, 'sell-1'), type: 'SELL', instrumentId: stock.id,
      quantity: '1', unitPrice: '5', commission: '0.50',
    });
    let snapshot = await posting.positionsForUser(owner.userId, owner.accountId);
    expect(snapshot.sales[0]).toMatchObject({
      eventId: firstSale.eventId, currency: 'PLN', cost: '0.33333333',
      netProceeds: '4.50', result: '4.16666667',
      allocations: [{ lotEventId: firstBuy.eventId, quantity: '1.0000000000', cost: '0.33333333' }],
    });
    expect(snapshot.positions[0]).toMatchObject({
      quantity: '4.0000000000', cost: '22.66666667',
      lots: [
        { eventId: firstBuy.eventId, quantity: '2.0000000000', cost: '0.66666667' },
        { eventId: secondBuy.eventId, quantity: '2.0000000000', cost: '22.00000000' },
      ],
    });

    await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 5, 'sell-2'), type: 'SELL', instrumentId: stock.id,
      quantity: '3', unitPrice: '8', commission: '1',
    });
    snapshot = await posting.positionsForUser(owner.userId, owner.accountId);
    expect(snapshot.sales[1]).toMatchObject({
      cost: '11.66666667', netProceeds: '23.00', result: '11.33333333',
      allocations: [
        { lotEventId: firstBuy.eventId, quantity: '2.0000000000', cost: '0.66666667' },
        { lotEventId: secondBuy.eventId, quantity: '1.0000000000', cost: '11.00000000' },
      ],
    });
    expect(snapshot.positions[0]).toMatchObject({ quantity: '1.0000000000', cost: '11.00000000' });

    await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 6, 'sell-3'), type: 'SELL', instrumentId: stock.id,
      quantity: '1', unitPrice: '9',
    });
    snapshot = await posting.positionsForUser(owner.userId, owner.accountId);
    expect(snapshot.positions).toEqual([]);
    expect(snapshot.sales[2]).toMatchObject({ cost: '11.00000000', result: '-2.00000000' });
  });

  it('distributes rounding remainder over three partial sales and handles fractional units', async () => {
    const owner = await account();
    const stock = await instrument('CDR', 'XWAR', 'PLN');
    await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 1, 'deposit'), type: 'DEPOSIT', currency: 'PLN', amount: '10',
    });
    await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 2, 'buy'), type: 'BUY', instrumentId: stock.id,
      quantity: '3', unitPrice: '0.33', commission: '0.01',
    });
    for (const sequence of [3, 4, 5]) {
      await posting.postForUser(owner.userId, {
        ...base(owner.accountId, sequence, `sell-${sequence}`), type: 'SELL', instrumentId: stock.id,
        quantity: '1', unitPrice: '1',
      });
    }
    const snapshot = await posting.positionsForUser(owner.userId, owner.accountId);
    expect(snapshot.sales.map((sale) => sale.cost)).toEqual(['0.33333333', '0.33333334', '0.33333333']);
    expect(snapshot.positions).toEqual([]);

    const fractional = await instrument('FRAC', 'XNYS', 'USD');
    await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 6, 'usd-deposit'), type: 'DEPOSIT', currency: 'USD', amount: '10',
    });
    await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 7, 'fractional-buy'), type: 'BUY', instrumentId: fractional.id,
      quantity: '0.75', unitPrice: '4', commission: '0.30',
    });
    await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 8, 'fractional-sell'), type: 'SELL', instrumentId: fractional.id,
      quantity: '0.25', unitPrice: '6',
    });
    const fractionalPosition = (await posting.positionsForUser(owner.userId, owner.accountId)).positions
      .find((position) => position.instrumentId === fractional.id);
    expect(fractionalPosition).toMatchObject({ quantity: '0.5000000000', cost: '2.20000000', currency: 'USD' });
  });

  it('records an opening lot with known cost and acquisition date without cash movement', async () => {
    const owner = await account();
    const stock = await instrument('CDR', 'XWAR', 'PLN');
    const opening = await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 1, 'opening'), type: 'OPENING_POSITION', instrumentId: stock.id,
      quantity: '1.5', totalCost: '30.12345678', acquiredOn: '2025-01-01',
    });
    expect((await posting.balancesForUser(owner.userId, owner.accountId)).cash.PLN).toBe('0.00');
    const stored = await prisma.openingLot.findUniqueOrThrow({ where: { eventId: opening.eventId } });
    expect(stored.totalCost.toString()).toBe('30.12345678');
    expect(stored.acquiredOn.toISOString().slice(0, 10)).toBe('2025-01-01');
    await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 2, 'sell'), type: 'SELL', instrumentId: stock.id,
      quantity: '0.5', unitPrice: '30', commission: '1',
    });
    const snapshot = await posting.positionsForUser(owner.userId, owner.accountId);
    expect(snapshot.positions[0]).toMatchObject({
      quantity: '1.0000000000', cost: '20.08230452',
      lots: [{ eventId: opening.eventId, acquiredOn: '2025-01-01' }],
    });
    expect(snapshot.sales[0]).toMatchObject({
      currency: 'PLN', netProceeds: '14.00', cost: '10.04115226', result: '3.95884774',
    });
    await expect(posting.postForUser(owner.userId, {
      ...base(owner.accountId, 3, 'bad-opening'), type: 'OPENING_POSITION', instrumentId: stock.id,
      quantity: '1', totalCost: '-1', acquiredOn: '2025-01-01',
    })).rejects.toThrow();
    await expect(posting.postForUser(owner.userId, {
      ...base(owner.accountId, 3, 'late-opening'), type: 'OPENING_POSITION', instrumentId: stock.id,
      quantity: '1', totalCost: '1', acquiredOn: '2026-11-11',
    })).rejects.toThrow();
  });

  it('does not expose positions to another account owner', async () => {
    const owner = await account();
    const stranger = await account();
    await expect(posting.positionsForUser(stranger.userId, owner.accountId)).rejects.toThrow();
  });
});
