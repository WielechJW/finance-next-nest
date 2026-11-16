import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Investment models (PostgreSQL)', () => {
  const emails = new Set<string>();
  const instrumentIds = new Set<string>();
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterEach(async () => {
    await prisma.instrumentProviderMapping.deleteMany({
      where: { instrumentId: { in: [...instrumentIds] } },
    });
    await prisma.instrument.deleteMany({
      where: { id: { in: [...instrumentIds] } },
    });
    await prisma.user.deleteMany({ where: { email: { in: [...emails] } } });
    instrumentIds.clear();
    emails.clear();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function createUser() {
    const email = `investment-${randomUUID()}@example.invalid`;
    emails.add(email);
    return prisma.user.create({
      data: { email, passwordHash: 'test-only-hash' },
    });
  }

  async function createInstrument() {
    const instrument = await prisma.instrument.create({
      data: {
        ticker: 'CDR',
        mic: 'XWAR',
        currency: 'PLN',
        isin: 'PL0000000001',
      },
    });
    instrumentIds.add(instrument.id);
    return instrument;
  }

  it('derives account ownership through its portfolio and rejects an orphan account', async () => {
    const owner = await createUser();
    const other = await createUser();
    const portfolio = await prisma.portfolio.create({
      data: { userId: owner.id, name: 'Akcje GPW i USA' },
    });
    const account = await prisma.investmentAccount.create({
      data: { portfolioId: portfolio.id, name: 'Rachunek ręczny' },
    });

    const stored = await prisma.investmentAccount.findUniqueOrThrow({
      where: { id: account.id },
      include: { portfolio: true },
    });
    expect(stored.portfolio.userId).toBe(owner.id);
    expect(
      await prisma.investmentAccount.count({
        where: { id: account.id, portfolio: { userId: other.id } },
      }),
    ).toBe(0);
    await expect(
      prisma.investmentAccount.create({
        data: { portfolioId: randomUUID(), name: 'Bez portfela' },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('keeps the instrument ID and provider mapping when its ticker changes', async () => {
    const instrument = await createInstrument();
    const mapping = await prisma.instrumentProviderMapping.create({
      data: {
        instrumentId: instrument.id,
        provider: 'EODHD',
        symbol: 'CDR.WAR',
      },
    });

    await prisma.instrument.update({
      where: { id: instrument.id },
      data: { ticker: 'CDPROJEKT' },
    });
    const stored = await prisma.instrumentProviderMapping.findUniqueOrThrow({
      where: { id: mapping.id },
      include: { instrument: true },
    });
    expect(stored).toMatchObject({
      instrumentId: instrument.id,
      provider: 'EODHD',
      symbol: 'CDR.WAR',
      instrument: {
        id: instrument.id,
        mic: 'XWAR',
        ticker: 'CDPROJEKT',
        currency: 'PLN',
        isin: 'PL0000000001',
      },
    });
    await expect(
      prisma.instrument.create({
        data: { ticker: 'CDPROJEKT', mic: 'XWAR', currency: 'PLN' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    const otherMarket = await prisma.instrument.create({
      data: { ticker: 'CDPROJEKT', mic: 'XNYS', currency: 'USD' },
    });
    instrumentIds.add(otherMarket.id);
    await expect(
      prisma.instrumentProviderMapping.create({
        data: {
          instrumentId: instrument.id,
          provider: 'EODHD',
          symbol: 'CDPROJEKT.WAR',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      prisma.instrumentProviderMapping.create({
        data: {
          instrumentId: otherMarket.id,
          provider: 'EODHD',
          symbol: 'CDR.WAR',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      prisma.instrument.delete({ where: { id: instrument.id } }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });
});
