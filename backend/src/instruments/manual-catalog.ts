import type { Prisma, PrismaClient } from '../generated/prisma/client.js';

// Initial reference metadata for the manual portfolio, without quotes/provider data.
// The sampled companies are documented in docs/market-data-verification.md.
export const MANUAL_INVESTMENT_INSTRUMENTS = [
  ...['CDR', 'PKN', 'PKO', 'PZU', 'KGH'].map((ticker) => ({
    ticker,
    mic: 'XWAR',
    currency: 'PLN' as const,
  })),
  ...['AAPL', 'MSFT', 'TSLA', 'AMZN'].map((ticker) => ({
    ticker,
    mic: 'XNAS',
    currency: 'USD' as const,
  })),
  { ticker: 'MCD', mic: 'XNYS', currency: 'USD' },
] satisfies Prisma.InstrumentCreateInput[];

export async function seedManualInvestmentCatalog(
  prisma: PrismaClient,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const instrument of MANUAL_INVESTMENT_INSTRUMENTS) {
      await tx.instrument.upsert({
        where: {
          mic_ticker: { mic: instrument.mic, ticker: instrument.ticker },
        },
        create: instrument,
        // Preserve existing IDs, metadata and references to trade history.
        update: {},
      });
    }
  });
}
