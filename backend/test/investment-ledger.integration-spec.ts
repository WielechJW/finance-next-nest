import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Investment ledger (PostgreSQL)', () => {
  const emails = new Set<string>();
  const instrumentIds = new Set<string>();
  const audit = { sourceKey: 'manual', recordedBy: 'test:ledger' };
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterEach(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [...emails] } } });
    await prisma.instrument.deleteMany({
      where: { id: { in: [...instrumentIds] } },
    });
    emails.clear();
    instrumentIds.clear();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function createAccount() {
    const email = `ledger-${randomUUID()}@example.invalid`;
    emails.add(email);
    const user = await prisma.user.create({
      data: { email, passwordHash: 'test-only-hash' },
    });
    const portfolio = await prisma.portfolio.create({
      data: { userId: user.id, name: 'Investments' },
    });
    return prisma.investmentAccount.create({
      data: { portfolioId: portfolio.id, name: 'Broker' },
    });
  }

  async function createInstrument() {
    const instrument = await prisma.instrument.create({
      data: { ticker: 'CDR', mic: 'XWAR', currency: 'PLN' },
    });
    instrumentIds.add(instrument.id);
    return instrument;
  }

  const occurredOn = new Date('2026-11-10T00:00:00.000Z');

  it('groups a buy, gross cash outflow and commission under one event', async () => {
    const account = await createAccount();
    const instrument = await createInstrument();
    const budgetCount = await prisma.transaction.count();
    const event = await prisma.$transaction(async (tx) => {
      const header = await tx.investmentEvent.create({
        data: { accountId: account.id, type: 'BUY', occurredOn, daySequence: 1, ...audit },
      });
      await tx.trade.create({
        data: {
          eventId: header.id,
          instrumentId: instrument.id,
          quantity: '2.5',
          unitPrice: '100.00',
          grossAmount: '250.00',
        },
      });
      await tx.securityEntry.create({
        data: { eventId: header.id, instrumentId: instrument.id, quantity: '2.5' },
      });
      await tx.cashEntry.createMany({
        data: [
          { eventId: header.id, kind: 'TRADE_GROSS', currency: 'PLN', amount: '-250.00' },
          { eventId: header.id, kind: 'COMMISSION', currency: 'PLN', amount: '-2.50' },
        ],
      });
      return header;
    });

    const stored = await prisma.investmentEvent.findUniqueOrThrow({
      where: { id: event.id },
      include: { trade: true, securityEntries: true, cashEntries: true },
    });
    expect(stored.accountId).toBe(account.id);
    expect(stored.trade?.instrumentId).toBe(instrument.id);
    expect(stored.trade?.quantity.toString()).toBe('2.5');
    expect(stored.securityEntries).toHaveLength(1);
    expect(stored.securityEntries[0].quantity.toString()).toBe('2.5');
    expect(stored.cashEntries.map(({ kind, amount }) => [kind, amount.toString()]))
      .toEqual(expect.arrayContaining([
        ['TRADE_GROSS', '-250'],
        ['COMMISSION', '-2.5'],
      ]));
    expect(await prisma.transaction.count()).toBe(budgetCount);

    await prisma.instrument.update({
      where: { id: instrument.id },
      data: { ticker: 'CDPROJEKT' },
    });
    expect((await prisma.trade.findUniqueOrThrow({ where: { eventId: event.id } })).instrumentId)
      .toBe(instrument.id);
  });

  it('keeps dividend gross, tax and fee, and both FX legs together', async () => {
    const account = await createAccount();
    const dividend = await prisma.investmentEvent.create({
      data: {
        accountId: account.id,
        type: 'DIVIDEND',
        source: 'BROKER',
        ...audit,
        sourceKey: 'test-broker',
        occurredOn,
        daySequence: 1,
        cashEntries: {
          create: [
            { kind: 'DIVIDEND_GROSS', currency: 'USD', amount: '10.00' },
            { kind: 'WITHHOLDING_TAX', currency: 'USD', amount: '-1.50' },
            { kind: 'FEE', currency: 'USD', amount: '-0.25' },
          ],
        },
      },
      include: { cashEntries: true },
    });
    expect(dividend.cashEntries).toHaveLength(3);
    expect(dividend.cashEntries.reduce((sum, entry) => sum + Number(entry.amount), 0))
      .toBe(8.25);

    const fx = await prisma.investmentEvent.create({
      data: {
        accountId: account.id,
        type: 'FX',
        ...audit,
        occurredOn,
        daySequence: 2,
        fxRatePlnPerUsd: '4',
        cashEntries: {
          create: [
            { kind: 'FX', currency: 'PLN', amount: '-100.00' },
            { kind: 'FX', currency: 'USD', amount: '25.00' },
            { kind: 'COMMISSION', currency: 'PLN', amount: '-1.00' },
          ],
        },
      },
      include: { cashEntries: true },
    });
    expect(fx.cashEntries).toHaveLength(3);
    expect(fx.cashEntries.filter((entry) => entry.kind === 'FX').map((entry) => entry.currency).sort())
      .toEqual(['PLN', 'USD']);
  });

  it('stores a sale and a split as signed quantity entries', async () => {
    const account = await createAccount();
    const instrument = await createInstrument();
    const sale = await prisma.investmentEvent.create({
      data: {
        accountId: account.id,
        type: 'SELL',
        ...audit,
        occurredOn,
        daySequence: 1,
        trade: {
          create: { instrumentId: instrument.id, quantity: '1', unitPrice: '110', grossAmount: '110' },
        },
        securityEntries: {
          create: { instrumentId: instrument.id, quantity: '-1' },
        },
        cashEntries: {
          create: [
            { kind: 'TRADE_GROSS', currency: 'PLN', amount: '110' },
            { kind: 'COMMISSION', currency: 'PLN', amount: '-1' },
          ],
        },
      },
      include: { securityEntries: true, cashEntries: true },
    });
    expect(sale.securityEntries[0].quantity.toString()).toBe('-1');
    expect(sale.cashEntries).toHaveLength(2);

    const split = await prisma.investmentEvent.create({
      data: {
        accountId: account.id,
        type: 'SPLIT',
        ...audit,
        occurredOn,
        daySequence: 2,
        securityEntries: {
          create: [
            { instrumentId: instrument.id, quantity: '-1' },
            { instrumentId: instrument.id, quantity: '2' },
          ],
        },
      },
      include: { securityEntries: true },
    });
    expect(split.securityEntries.map((entry) => entry.quantity.toString()).sort())
      .toEqual(['-1', '2']);
  });

  it('links a correction to an event in the same account and requires a reason', async () => {
    const account = await createAccount();
    const otherAccount = await createAccount();
    const original = await prisma.investmentEvent.create({
      data: {
        accountId: account.id,
        type: 'DEPOSIT',
        ...audit,
        occurredOn,
        daySequence: 1,
        cashEntries: { create: { kind: 'EXTERNAL_TRANSFER', currency: 'PLN', amount: '100' } },
      },
    });
    const correction = await prisma.investmentEvent.create({
      data: {
        accountId: account.id,
        type: 'CORRECTION',
        ...audit,
        occurredOn,
        daySequence: 2,
        correctionOfId: original.id,
        correctionReason: 'Incorrect deposit amount',
        cashEntries: { create: { kind: 'EXTERNAL_TRANSFER', currency: 'PLN', amount: '-10' } },
      },
      include: { correctionOf: true },
    });
    expect(correction.correctionOf?.id).toBe(original.id);
    await expect(
      prisma.investmentEvent.create({
        data: {
          accountId: otherAccount.id,
          type: 'CORRECTION',
          ...audit,
          occurredOn,
          daySequence: 1,
          correctionOfId: original.id,
          correctionReason: 'Wrong account',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      prisma.investmentEvent.create({
        data: { accountId: account.id, type: 'CORRECTION', occurredOn, daySequence: 3, correctionOfId: original.id, ...audit },
      }),
    ).rejects.toThrow();
  });

  it('rolls back the whole event when a ledger entry fails', async () => {
    const account = await createAccount();
    const eventId = randomUUID();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.investmentEvent.create({
          data: { id: eventId, accountId: account.id, type: 'DEPOSIT', occurredOn, daySequence: 1, ...audit },
        });
        await tx.cashEntry.create({
          data: { eventId, kind: 'EXTERNAL_TRANSFER', currency: 'PLN', amount: '100' },
        });
        await tx.cashEntry.create({
          data: { eventId, kind: 'FEE', currency: 'PLN', amount: '0' },
        });
      }),
    ).rejects.toThrow();
    expect(await prisma.investmentEvent.count({ where: { id: eventId } })).toBe(0);
    expect(await prisma.cashEntry.count({ where: { eventId } })).toBe(0);
  });

  it('orders tied execution times by explicit sequence, independently of UUID and registration time', async () => {
    const account = await createAccount();
    const executedAt = new Date('2026-11-10T10:00:00.000Z');
    const second = await prisma.investmentEvent.create({
      data: {
        accountId: account.id,
        type: 'DEPOSIT',
        ...audit,
        occurredOn,
        daySequence: 2,
        timePrecision: 'INSTANT',
        executedAt,
        sourceTimeZone: 'Europe/Warsaw',
        settledOn: new Date('2026-11-12T00:00:00.000Z'),
      },
    });
    const first = await prisma.investmentEvent.create({
      data: {
        accountId: account.id,
        type: 'DEPOSIT',
        ...audit,
        occurredOn,
        daySequence: 1,
        timePrecision: 'INSTANT',
        executedAt,
        sourceTimeZone: 'Europe/Warsaw',
      },
    });
    const ordered = await prisma.investmentEvent.findMany({
      where: { accountId: account.id, occurredOn },
      orderBy: { daySequence: 'asc' },
    });
    expect(ordered.map((event) => event.id)).toEqual([first.id, second.id]);
    expect(ordered.every((event) => event.orderingSource === 'EXPLICIT')).toBe(true);
    await expect(prisma.investmentEvent.create({
      data: { accountId: account.id, type: 'DEPOSIT', occurredOn, daySequence: 1, ...audit },
    })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects inconsistent instants, fractional cents and invalid FX rates in PostgreSQL', async () => {
    const account = await createAccount();
    const instrument = await createInstrument();
    await expect(prisma.investmentEvent.create({
      data: {
        accountId: account.id,
        type: 'DEPOSIT',
        ...audit,
        occurredOn,
        daySequence: 1,
        timePrecision: 'INSTANT',
        executedAt: new Date('2026-11-09T22:00:00.000Z'),
        sourceTimeZone: 'Europe/Warsaw',
      },
    })).rejects.toThrow();
    await expect(prisma.investmentEvent.create({
      data: { accountId: account.id, type: 'FX', occurredOn, daySequence: 1, fxRatePlnPerUsd: '-1', ...audit },
    })).rejects.toThrow();

    const event = await prisma.investmentEvent.create({
      data: { accountId: account.id, type: 'BUY', occurredOn, daySequence: 1, ...audit },
    });
    await expect(prisma.cashEntry.create({
      data: { eventId: event.id, kind: 'TRADE_GROSS', currency: 'PLN', amount: '-1.001' },
    })).rejects.toThrow();
    await expect(prisma.trade.create({
      data: { eventId: event.id, instrumentId: instrument.id, quantity: '1', unitPrice: '1', grossAmount: '1.001' },
    })).rejects.toThrow();
  });

  it('stores one external operation despite concurrent retries', async () => {
    const account = await createAccount();
    const attempts = await Promise.allSettled([1, 2].map((daySequence) =>
      prisma.investmentEvent.create({
        data: {
          accountId: account.id,
          type: 'DEPOSIT',
          source: 'BROKER',
          sourceKey: 'fixture-broker',
          externalOperationId: 'execution-42',
          recordedBy: 'broker:fixture-broker',
          occurredOn,
          daySequence,
        },
      }),
    ));
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
    expect(await prisma.investmentEvent.count({
      where: { accountId: account.id, sourceKey: 'fixture-broker', externalOperationId: 'execution-42' },
    })).toBe(1);
  });

  it('scopes external IDs to account and concrete source, and request keys to account', async () => {
    const account = await createAccount();
    const otherAccount = await createAccount();
    const external = {
      type: 'DEPOSIT' as const,
      source: 'BROKER' as const,
      externalOperationId: 'same-provider-id',
      recordedBy: 'broker:fixture',
      occurredOn,
    };
    await prisma.investmentEvent.create({
      data: { ...external, accountId: account.id, sourceKey: 'broker-one', daySequence: 1 },
    });
    await prisma.investmentEvent.create({
      data: { ...external, accountId: account.id, sourceKey: 'broker-two', daySequence: 2 },
    });
    await prisma.investmentEvent.create({
      data: { ...external, accountId: otherAccount.id, sourceKey: 'broker-one', daySequence: 1 },
    });
    const manual = await prisma.investmentEvent.create({
      data: {
        accountId: account.id,
        type: 'DEPOSIT',
        occurredOn,
        daySequence: 3,
        idempotencyKey: 'request-abc',
        ...audit,
      },
    });
    await expect(prisma.investmentEvent.create({
      data: {
        accountId: account.id,
        type: 'DEPOSIT',
        occurredOn,
        daySequence: 4,
        idempotencyKey: 'request-abc',
        ...audit,
      },
    })).rejects.toMatchObject({ code: 'P2002' });
    await prisma.investmentEvent.create({
      data: {
        accountId: otherAccount.id,
        type: 'DEPOSIT',
        occurredOn,
        daySequence: 2,
        idempotencyKey: 'request-abc',
        ...audit,
      },
    });
    expect(await prisma.investmentEvent.count({ where: { id: manual.id } })).toBe(1);
  });

  it('preserves original details and the correction author in the audit trail', async () => {
    const account = await createAccount();
    const original = await prisma.investmentEvent.create({
      data: {
        accountId: account.id,
        type: 'DEPOSIT',
        occurredOn,
        daySequence: 1,
        recordedBy: `user:${randomUUID()}`,
        sourceKey: 'manual',
        cashEntries: {
          create: { kind: 'EXTERNAL_TRANSFER', currency: 'PLN', amount: '100' },
        },
      },
      include: { cashEntries: true },
    });
    const author = `user:${randomUUID()}`;
    const correction = await prisma.investmentEvent.create({
      data: {
        accountId: account.id,
        type: 'CORRECTION',
        occurredOn,
        daySequence: 2,
        sourceKey: 'manual',
        recordedBy: author,
        correctionOfId: original.id,
        correctionReason: 'Corrected amount after reconciliation',
        cashEntries: {
          create: { kind: 'EXTERNAL_TRANSFER', currency: 'PLN', amount: '-10' },
        },
      },
      include: { correctionOf: true, cashEntries: true },
    });
    expect(correction).toMatchObject({
      correctionOfId: original.id,
      correctionReason: 'Corrected amount after reconciliation',
      recordedBy: author,
      correctionOf: { id: original.id },
    });
    expect(correction.recordedAt).toBeInstanceOf(Date);
    expect((await prisma.investmentEvent.findUniqueOrThrow({
      where: { id: original.id }, include: { cashEntries: true },
    })).cashEntries[0].amount.toString()).toBe('100');
    expect(correction.cashEntries[0].amount.toString()).toBe('-10');
  });

  it('keeps quantity and unit price positive at the database boundary', async () => {
    const account = await createAccount();
    const instrument = await createInstrument();
    const event = await prisma.investmentEvent.create({
      data: { accountId: account.id, type: 'BUY', occurredOn, daySequence: 1, ...audit },
    });
    for (const [quantity, unitPrice] of [['0', '1'], ['1', '0'], ['-1', '1'], ['1', '-1']]) {
      await expect(prisma.trade.create({
        data: { eventId: event.id, instrumentId: instrument.id, quantity, unitPrice, grossAmount: '1' },
      })).rejects.toThrow();
    }
    expect(await prisma.trade.count({ where: { eventId: event.id } })).toBe(0);
  });

  it('rejects empty source, request and author identifiers', async () => {
    const account = await createAccount();
    const base = { accountId: account.id, type: 'DEPOSIT' as const, occurredOn, daySequence: 1 };
    for (const data of [
      { ...base, sourceKey: ' ', recordedBy: 'user:test' },
      { ...base, sourceKey: 'manual', recordedBy: ' ' },
      { ...base, sourceKey: 'manual', recordedBy: 'user:test', idempotencyKey: ' ' },
      { ...base, source: 'BROKER' as const, sourceKey: 'broker-one', recordedBy: 'broker:test', externalOperationId: ' ' },
      { ...base, sourceKey: 'manual', recordedBy: 'user:test', externalOperationId: 'execution' },
    ]) {
      await expect(prisma.investmentEvent.create({ data })).rejects.toThrow();
    }
    expect(await prisma.investmentEvent.count({ where: { accountId: account.id } })).toBe(0);
  });
});
