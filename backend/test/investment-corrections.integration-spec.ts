import { randomUUID } from 'node:crypto';
import { InvestmentPostingService } from '../src/investments/posting.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Investment concurrency and revisions (PostgreSQL)', () => {
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
    const email = `revision-${randomUUID()}@example.invalid`;
    emails.add(email);
    const user = await prisma.user.create({ data: { email, passwordHash: 'test-hash' } });
    const portfolio = await prisma.portfolio.create({ data: { userId: user.id, name: 'Revisions' } });
    const investmentAccount = await prisma.investmentAccount.create({
      data: { portfolioId: portfolio.id, name: 'Broker' },
    });
    return { userId: user.id, accountId: investmentAccount.id };
  }
  async function instrument() {
    const value = await prisma.instrument.create({ data: { ticker: 'CDR', mic: 'XWAR', currency: 'PLN' } });
    instrumentIds.add(value.id);
    return value;
  }
  function base(accountId: string, daySequence: number, idempotencyKey: string, occurredOn = '2026-11-10') {
    return { accountId, daySequence, idempotencyKey, occurredOn, timePrecision: 'DATE' as const };
  }

  it('serializes competing sales so only one can consume the same share', async () => {
    const owner = await account();
    const stock = await instrument();
    await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 1, 'deposit'), type: 'DEPOSIT', currency: 'PLN', amount: '100',
    });
    await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 2, 'buy'), type: 'BUY', instrumentId: stock.id,
      quantity: '1', unitPrice: '50',
    });
    const results = await Promise.allSettled([3, 4].map((sequence) => posting.postForUser(owner.userId, {
      ...base(owner.accountId, sequence, `sell-${sequence}`), type: 'SELL', instrumentId: stock.id,
      quantity: '1', unitPrice: '60',
    })));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await prisma.investmentEvent.count({ where: { accountId: owner.accountId, type: 'SELL' } })).toBe(1);
    expect((await posting.balancesForUser(owner.userId, owner.accountId)).securities[stock.id]).toBe('0.0000000000');
  });

  it('replays FIFO after a buy revision, keeps the old version and safely retries', async () => {
    const owner = await account();
    const stock = await instrument();
    await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 1, 'deposit'), type: 'DEPOSIT', currency: 'PLN', amount: '1000',
    });
    const buy = await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 2, 'buy'), type: 'BUY', instrumentId: stock.id,
      quantity: '2', unitPrice: '100', commission: '2',
    });
    await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 3, 'sell'), type: 'SELL', instrumentId: stock.id,
      quantity: '1', unitPrice: '150', commission: '1',
    });
    expect((await posting.positionsForUser(owner.userId, owner.accountId)).sales[0].result).toBe('48.00000000');

    const correction = {
      accountId: owner.accountId, targetEventId: buy.eventId, expectedRevision: 0,
      reason: 'Correct purchase price', idempotencyKey: 'correct-buy',
      replacement: {
        ...base(owner.accountId, 2, 'correct-buy'), type: 'BUY' as const, instrumentId: stock.id,
        quantity: '2', unitPrice: '120', commission: '4',
      },
    };
    const first = await posting.correctForUser(owner.userId, correction);
    expect(first).toMatchObject({ duplicate: false, revision: 1 });
    expect(await posting.correctForUser(owner.userId, correction)).toEqual({ ...first, duplicate: true });
    const snapshot = await posting.positionsForUser(owner.userId, owner.accountId);
    expect(snapshot.positions[0]).toMatchObject({ quantity: '1.0000000000', cost: '122.00000000' });
    expect(snapshot.sales[0]).toMatchObject({ cost: '122.00000000', result: '27.00000000' });
    expect((await posting.balancesForUser(owner.userId, owner.accountId)).cash.PLN).toBe('905.00');
    const oldVersion = await prisma.investmentEvent.findUniqueOrThrow({ where: { id: buy.eventId } });
    const newVersion = await prisma.investmentEvent.findUniqueOrThrow({ where: { id: first.eventId } });
    expect(oldVersion).toMatchObject({ activeSlot: null, revision: 0 });
    expect(newVersion).toMatchObject({ activeSlot: 1, revision: 1,
      correctionOfId: buy.eventId, correctionReason: 'Correct purchase price',
      recordedBy: `user:${owner.userId}` });
    await expect(posting.correctForUser(owner.userId, {
      ...correction, idempotencyKey: 'stale', replacement: { ...correction.replacement, idempotencyKey: 'stale' },
    })).rejects.toThrow();
    expect(await prisma.investmentEvent.count({ where: { accountId: owner.accountId } })).toBe(4);
  });

  it('rejects a correction that makes a later sale negative and preserves both versions', async () => {
    const owner = await account();
    const stock = await instrument();
    await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 1, 'deposit'), type: 'DEPOSIT', currency: 'PLN', amount: '100',
    });
    const buy = await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 2, 'buy'), type: 'BUY', instrumentId: stock.id,
      quantity: '1', unitPrice: '20',
    });
    await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 3, 'sell'), type: 'SELL', instrumentId: stock.id,
      quantity: '1', unitPrice: '30',
    });
    await expect(posting.correctForUser(owner.userId, {
      accountId: owner.accountId, targetEventId: buy.eventId, expectedRevision: 0,
      reason: 'Wrong quantity', idempotencyKey: 'bad-revision',
      replacement: { ...base(owner.accountId, 2, 'bad-revision'), type: 'BUY',
        instrumentId: stock.id, quantity: '0.5', unitPrice: '20' },
    })).rejects.toThrow();
    expect(await prisma.investmentEvent.count({ where: { accountId: owner.accountId } })).toBe(3);
    expect((await prisma.investmentEvent.findUniqueOrThrow({ where: { id: buy.eventId } })).activeSlot).toBe(1);
    expect((await posting.positionsForUser(owner.userId, owner.accountId)).sales[0].result).toBe('10.00000000');
  });

  it('replays a backdated purchase and supports cancellation and reactivation', async () => {
    const owner = await account();
    const stock = await instrument();
    await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 1, 'deposit', '2026-11-09'), type: 'DEPOSIT', currency: 'PLN', amount: '100',
    });
    await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 2, 'later-buy'), type: 'BUY', instrumentId: stock.id,
      quantity: '1', unitPrice: '10',
    });
    const sale = await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 3, 'sale'), type: 'SELL', instrumentId: stock.id,
      quantity: '1', unitPrice: '20',
    });
    const earlierBuy = await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 2, 'earlier-buy', '2026-11-09'), type: 'BUY',
      instrumentId: stock.id, quantity: '1', unitPrice: '5',
    });
    let snapshot = await posting.positionsForUser(owner.userId, owner.accountId);
    expect(snapshot.sales[0]).toMatchObject({ cost: '5.00000000', result: '15.00000000',
      allocations: [{ lotEventId: earlierBuy.eventId, quantity: '1.0000000000', cost: '5.00000000' }] });
    expect(snapshot.positions[0]).toMatchObject({ cost: '10.00000000', quantity: '1.0000000000' });

    const cancelled = await posting.correctForUser(owner.userId, {
      accountId: owner.accountId, targetEventId: sale.eventId, expectedRevision: 0,
      reason: 'Sale was not executed', idempotencyKey: 'cancel-sale', replacement: null,
    });
    snapshot = await posting.positionsForUser(owner.userId, owner.accountId);
    expect(snapshot.sales).toEqual([]);
    expect(snapshot.positions[0]).toMatchObject({ cost: '15.00000000', quantity: '2.0000000000' });
    expect((await prisma.investmentEvent.findUniqueOrThrow({ where: { id: cancelled.eventId } })).type).toBe('CORRECTION');

    const restored = await posting.correctForUser(owner.userId, {
      accountId: owner.accountId, targetEventId: cancelled.eventId, expectedRevision: 1,
      reason: 'Confirmed by broker', idempotencyKey: 'restore-sale',
      replacement: { ...base(owner.accountId, 3, 'restore-sale'), type: 'SELL',
        instrumentId: stock.id, quantity: '1', unitPrice: '20' },
    });
    expect(restored.revision).toBe(2);
    expect((await posting.positionsForUser(owner.userId, owner.accountId)).sales[0].result).toBe('15.00000000');
  });

  it('keeps correction ownership and concurrent idempotent retries safe', async () => {
    const owner = await account();
    const stranger = await account();
    const input = { ...base(owner.accountId, 1, 'same-request'), type: 'DEPOSIT' as const,
      currency: 'PLN' as const, amount: '100' };
    const [first, retry] = await Promise.all([
      posting.postForUser(owner.userId, input), posting.postForUser(owner.userId, input),
    ]);
    expect(first.eventId).toBe(retry.eventId);
    expect(first.duplicate).toBe(!retry.duplicate);
    expect(await prisma.investmentEvent.count({ where: { accountId: owner.accountId } })).toBe(1);
    await expect(posting.correctForUser(stranger.userId, {
      accountId: owner.accountId, targetEventId: first.eventId, expectedRevision: 0,
      reason: 'Unauthorized', idempotencyKey: 'intrusion', replacement: null,
    })).rejects.toThrow();
    expect((await prisma.investmentEvent.findUniqueOrThrow({ where: { id: first.eventId } })).activeSlot).toBe(1);
  });
});
