import {
  MANUAL_INVESTMENT_INSTRUMENTS,
  seedManualInvestmentCatalog,
} from '../src/instruments/manual-catalog.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Manual investment catalog (PostgreSQL)', () => {
  let prisma: PrismaService;
  let originalIds: string[];
  const where = {
    OR: MANUAL_INVESTMENT_INSTRUMENTS.map(({ ticker, mic }) => ({
      ticker,
      mic,
    })),
  };
  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    originalIds = (
      await prisma.instrument.findMany({ where, select: { id: true } })
    ).map((item) => item.id);
  });
  afterAll(async () => {
    await prisma.instrument.deleteMany({
      where: { ...where, id: { notIn: originalIds } },
    });
    await prisma.$disconnect();
  });
  it('preserves catalog identities and existing provider mappings on repeated setup', async () => {
    await seedManualInvestmentCatalog(prisma);
    const first = await prisma.instrument.findMany({
      where,
      orderBy: { id: 'asc' },
    });
    expect(first).toHaveLength(10);
    const mapping = await prisma.instrumentProviderMapping.create({
      data: {
        instrumentId: first[0].id,
        provider: 'MANUAL_SEED_ACCEPTANCE',
        symbol: 'isolated-test',
      },
    });
    try {
      await seedManualInvestmentCatalog(prisma);
      const second = await prisma.instrument.findMany({
        where,
        orderBy: { id: 'asc' },
      });
      expect(second).toEqual(first);
      expect(
        await prisma.instrumentProviderMapping.findUniqueOrThrow({
          where: { id: mapping.id },
        }),
      ).toMatchObject({ instrumentId: first[0].id });
    } finally {
      await prisma.instrumentProviderMapping.delete({
        where: { id: mapping.id },
      });
    }
  });
});
