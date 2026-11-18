import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MarketDataError, type CatalogInstrument } from './contracts.js';
import { EodhdProvider } from './eodhd.provider.js';

@Injectable()
export class MarketInstrumentsService {
  constructor(private readonly prisma: PrismaService, private readonly provider: EodhdProvider) {}
  async importCatalog(rows: CatalogInstrument[]) {
    // Each instrument is atomic; retrying a partially imported catalog preserves IDs.
    let imported = 0;
    for (const row of rows) {
      await this.prisma.$transaction(async tx => {
        const mapping = await tx.instrumentProviderMapping.findUnique({ where: { provider_symbol: { provider: 'EODHD', symbol: row.symbol } }, include: { instrument: true } });
        const identities = row.isin ? await tx.instrument.findMany({ where: { isin: row.isin }, take: 2 }) : [];
        if (!mapping && identities.length > 1) throw new MarketDataError('invalid_data', 'Niejednoznaczna tożsamość instrumentu.');
        const existing = mapping?.instrument ?? identities[0] ?? await tx.instrument.findUnique({ where: { mic_ticker: { mic: row.mic, ticker: row.ticker } } });
        if (existing && (existing.currency !== row.currency || existing.mic !== row.mic || (existing.isin && row.isin && existing.isin !== row.isin))) throw new MarketDataError('invalid_data', 'Zmiana tożsamości instrumentu wymaga sprawdzenia.');
        const data = { name: row.name, ticker: row.ticker, isin: row.isin ?? existing?.isin ?? null };
        const instrument = existing ? await tx.instrument.update({ where: { id: existing.id }, data }) : await tx.instrument.create({ data: { ...data, mic: row.mic, currency: row.currency } });
        await tx.instrumentProviderMapping.upsert({ where: { instrumentId_provider: { instrumentId: instrument.id, provider: 'EODHD' } }, create: { instrumentId: instrument.id, provider: 'EODHD', symbol: row.symbol }, update: { symbol: row.symbol } });
      });
      imported += 1;
    }
    return { imported };
  }
  async synchronize() {
    const results = [];
    for (const exchange of ['WAR', 'US'] as const) results.push({ exchange, ...await this.importCatalog(await this.provider.catalog(exchange)) });
    return results;
  }
  async search(query: { q?: string; mic?: string; page: number; pageSize: number }) {
    const where = { ...(query.mic ? { mic: query.mic } : {}), ...(query.q ? { OR: [
      { ticker: { contains: query.q, mode: 'insensitive' as const } }, { name: { contains: query.q, mode: 'insensitive' as const } }, { isin: { equals: query.q.toUpperCase() } },
    ] } : {}) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.instrument.findMany({ where, select: { id: true, ticker: true, name: true, mic: true, currency: true, isin: true }, orderBy: [{ ticker: 'asc' }, { id: 'asc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.instrument.count({ where }),
    ], { isolationLevel: 'RepeatableRead' });
    return { items, total, page: query.page, pageSize: query.pageSize };
  }
}
