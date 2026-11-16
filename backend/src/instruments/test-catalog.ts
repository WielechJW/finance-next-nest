import type { Prisma, PrismaClient } from '../generated/prisma/client.js';

// Fictitious instruments with stable IDs. Never enable this catalog in production.
export const INVESTMENT_TEST_INSTRUMENTS = [
  {
    id: '20000000-0000-4000-8000-000000000001',
    ticker: 'TESTPL',
    mic: 'XWAR',
    currency: 'PLN',
    isin: null,
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    ticker: 'TESTUS',
    mic: 'XNYS',
    currency: 'USD',
    isin: null,
  },
] as const satisfies readonly Prisma.InstrumentUncheckedCreateInput[];

export const INVESTMENT_TEST_MAPPINGS = [
  {
    id: '21000000-0000-4000-8000-000000000001',
    instrumentId: INVESTMENT_TEST_INSTRUMENTS[0].id,
    provider: 'TEST_FIXTURE',
    symbol: 'TESTPL.WAR',
  },
  {
    id: '21000000-0000-4000-8000-000000000002',
    instrumentId: INVESTMENT_TEST_INSTRUMENTS[1].id,
    provider: 'TEST_FIXTURE',
    symbol: 'TESTUS.US',
  },
] as const satisfies readonly Prisma.InstrumentProviderMappingUncheckedCreateInput[];

export async function seedInvestmentTestCatalog(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const instrument of INVESTMENT_TEST_INSTRUMENTS) {
      await tx.instrument.upsert({
        where: { id: instrument.id },
        create: instrument,
        update: {
          ticker: instrument.ticker,
          mic: instrument.mic,
          currency: instrument.currency,
          isin: instrument.isin,
        },
      });
    }
    for (const mapping of INVESTMENT_TEST_MAPPINGS) {
      await tx.instrumentProviderMapping.upsert({
        where: { id: mapping.id },
        create: mapping,
        update: {
          instrumentId: mapping.instrumentId,
          provider: mapping.provider,
          symbol: mapping.symbol,
        },
      });
    }
  });
}
