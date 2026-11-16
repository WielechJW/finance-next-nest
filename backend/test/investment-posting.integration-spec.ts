import { randomUUID } from 'node:crypto';
import { InvestmentPostingService } from '../src/investments/posting.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Investment posting (PostgreSQL)', () => {
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
    const email = `posting-${randomUUID()}@example.invalid`;
    emails.add(email);
    const user = await prisma.user.create({ data: { email, passwordHash: 'test-hash' } });
    const portfolio = await prisma.portfolio.create({ data: { userId: user.id, name: 'Posting' } });
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
  function base(accountId: string, daySequence: number, idempotencyKey: string, occurredOn = '2026-11-10') {
    return { accountId, daySequence, idempotencyKey, occurredOn, timePrecision: 'DATE' as const };
  }

  it('posts buy and sell with commission and exact cash/quantity balances', async () => {
    const owner = await account();
    const stock = await instrument('CDR', 'XWAR', 'PLN');
    await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 1, 'deposit-1'), type: 'DEPOSIT', currency: 'PLN', amount: '1000',
    });
    const buy = await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 2, 'buy-1'), type: 'BUY', instrumentId: stock.id,
      quantity: '3', unitPrice: '100.005', commission: '2.50',
    });
    const sell = await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 3, 'sell-1'), type: 'SELL', instrumentId: stock.id,
      quantity: '1', unitPrice: '120', commission: '1.00',
    });
    const balances = await posting.balancesForUser(owner.userId, owner.accountId);
    expect(balances).toEqual({ cash: { PLN: '816.48', USD: '0.00' }, securities: { [stock.id]: '2.0000000000' } });
    const events = await prisma.investmentEvent.findMany({
      where: { id: { in: [buy.eventId, sell.eventId] } },
      include: { trade: true, cashEntries: true, securityEntries: true },
    });
    expect(events.find((event) => event.id === buy.eventId)?.trade?.grossAmount.toString()).toBe('300.02');
    expect(events.find((event) => event.id === sell.eventId)?.cashEntries.map((entry) => entry.amount.toString()).sort())
      .toEqual(['-1', '120']);
    await expect(posting.postForUser(owner.userId, {
      ...base(owner.accountId, 4, 'oversell'), type: 'SELL', instrumentId: stock.id,
      quantity: '3', unitPrice: '120',
    })).rejects.toThrow();
  });

  it('uses actual FX legs and USD cash for a USD purchase, dividend and fee', async () => {
    const owner = await account();
    const stock = await instrument('TESTUS', 'XNYS', 'USD');
    await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 1, 'deposit-pln'), type: 'DEPOSIT', currency: 'PLN', amount: '1000',
    });
    await expect(posting.postForUser(owner.userId, {
      ...base(owner.accountId, 2, 'early-usd-buy'), type: 'BUY', instrumentId: stock.id,
      quantity: '1', unitPrice: '50',
    })).rejects.toThrow();
    const fx = await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 2, 'fx-1'), type: 'FX', soldCurrency: 'PLN', boughtCurrency: 'USD',
      soldAmount: '500', boughtAmount: '125', commission: '2',
    });
    await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 3, 'usd-buy'), type: 'BUY', instrumentId: stock.id,
      quantity: '2', unitPrice: '50', commission: '1',
    });
    await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 4, 'dividend'), type: 'DIVIDEND', currency: 'USD',
      grossAmount: '10', withholdingTax: '1.50', fee: '0.25',
    });
    await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 5, 'fee'), type: 'FEE', currency: 'USD', amount: '2',
    });
    const balances = await posting.balancesForUser(owner.userId, owner.accountId);
    expect(balances).toEqual({ cash: { PLN: '498.00', USD: '30.25' }, securities: { [stock.id]: '2.0000000000' } });
    const storedFx = await prisma.investmentEvent.findUniqueOrThrow({
      where: { id: fx.eventId }, include: { cashEntries: true },
    });
    expect(storedFx.fxRatePlnPerUsd?.toString()).toBe('4');
    expect(storedFx.cashEntries).toHaveLength(3);
    expect(new Set(storedFx.cashEntries.map((entry) => entry.currency))).toEqual(new Set(['PLN', 'USD']));
  });

  it('returns the original event for a matching retry and rejects changed content', async () => {
    const owner = await account();
    const input = { ...base(owner.accountId, 1, 'request-1'), type: 'DEPOSIT' as const, currency: 'PLN' as const, amount: '100' };
    const first = await posting.postForUser(owner.userId, input);
    const retry = await posting.postForUser(owner.userId, input);
    expect(first.duplicate).toBe(false);
    expect(retry).toEqual({ eventId: first.eventId, duplicate: true });
    await expect(posting.postForUser(owner.userId, { ...input, amount: '101' })).rejects.toThrow();
    expect(await prisma.investmentEvent.count({ where: { accountId: owner.accountId } })).toBe(1);
  });

  it('rejects historical withdrawals that would make a later purchase negative', async () => {
    const owner = await account();
    const stock = await instrument('CDR', 'XWAR', 'PLN');
    await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 1, 'opening', '2026-11-09'), type: 'DEPOSIT', currency: 'PLN', amount: '100',
    });
    await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 2, 'buy'), type: 'BUY', instrumentId: stock.id, quantity: '1', unitPrice: '90',
    });
    await expect(posting.postForUser(owner.userId, {
      ...base(owner.accountId, 1, 'retro-withdraw'), type: 'WITHDRAWAL', currency: 'PLN', amount: '20',
    })).rejects.toThrow();
    expect((await posting.balancesForUser(owner.userId, owner.accountId)).cash.PLN).toBe('10.00');
    expect(await prisma.investmentEvent.count({ where: { accountId: owner.accountId } })).toBe(2);
  });

  it('rolls back the header and trade if a cash entry fails in PostgreSQL', async () => {
    const owner = await account();
    const stock = await instrument('CDR', 'XWAR', 'PLN');
    await posting.postForUser(owner.userId, {
      ...base(owner.accountId, 1, 'deposit'), type: 'DEPOSIT', currency: 'PLN', amount: '100',
    });
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION test_reject_posting_commission() RETURNS trigger AS $$
      BEGIN
        IF NEW."kind" = 'COMMISSION' AND NEW."amount" = -9 THEN
          RAISE EXCEPTION 'test rejection';
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_reject_posting_commission_trigger
      BEFORE INSERT ON "CashEntry"
      FOR EACH ROW EXECUTE FUNCTION test_reject_posting_commission()
    `);
    try {
      await expect(posting.postForUser(owner.userId, {
        ...base(owner.accountId, 2, 'failed-buy'), type: 'BUY', instrumentId: stock.id,
        quantity: '1', unitPrice: '50', commission: '9',
      })).rejects.toThrow();
      expect(await prisma.investmentEvent.count({ where: { accountId: owner.accountId } })).toBe(1);
      expect(await prisma.trade.count({ where: { event: { accountId: owner.accountId } } })).toBe(0);
      expect((await posting.balancesForUser(owner.userId, owner.accountId)).cash.PLN).toBe('100.00');
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER test_reject_posting_commission_trigger ON "CashEntry"');
      await prisma.$executeRawUnsafe('DROP FUNCTION test_reject_posting_commission()');
    }
  });

  it('keeps accounts private for both posting and balance reads', async () => {
    const owner = await account();
    const stranger = await account();
    await expect(posting.postForUser(stranger.userId, {
      ...base(owner.accountId, 1, 'intrusion'), type: 'DEPOSIT', currency: 'PLN', amount: '100',
    })).rejects.toThrow();
    await expect(posting.balancesForUser(stranger.userId, owner.accountId)).rejects.toThrow();
    expect(await prisma.investmentEvent.count({ where: { accountId: owner.accountId } })).toBe(0);
  });
});
