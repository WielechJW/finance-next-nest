import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  INVESTMENT_TEST_INSTRUMENTS,
  INVESTMENT_TEST_MAPPINGS,
  seedInvestmentTestCatalog,
} from '../src/instruments/test-catalog.js';

describe('Investment test catalog seed (PostgreSQL)', () => {
  let prisma: PrismaService;
  const instrumentIds = INVESTMENT_TEST_INSTRUMENTS.map((item) => item.id);
  const mappingIds = INVESTMENT_TEST_MAPPINGS.map((item) => item.id);

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterEach(async () => {
    await prisma.instrumentProviderMapping.deleteMany({ where: { id: { in: mappingIds } } });
    await prisma.instrument.deleteMany({ where: { id: { in: instrumentIds } } });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('can run repeatedly without duplicating instruments or provider mappings', async () => {
    await seedInvestmentTestCatalog(prisma);
    await seedInvestmentTestCatalog(prisma);

    const instruments = await prisma.instrument.findMany({
      where: { id: { in: instrumentIds } },
      orderBy: { id: 'asc' },
    });
    const mappings = await prisma.instrumentProviderMapping.findMany({
      where: { id: { in: mappingIds } },
      orderBy: { id: 'asc' },
    });
    expect(instruments).toHaveLength(2);
    expect(instruments.map(({ ticker, mic, currency }) => ({ ticker, mic, currency })))
      .toEqual([
        { ticker: 'TESTPL', mic: 'XWAR', currency: 'PLN' },
        { ticker: 'TESTUS', mic: 'XNYS', currency: 'USD' },
      ]);
    expect(mappings.map(({ instrumentId, provider, symbol }) => ({ instrumentId, provider, symbol })))
      .toEqual([
        { instrumentId: instrumentIds[0], provider: 'TEST_FIXTURE', symbol: 'TESTPL.WAR' },
        { instrumentId: instrumentIds[1], provider: 'TEST_FIXTURE', symbol: 'TESTUS.US' },
      ]);
  });
});
