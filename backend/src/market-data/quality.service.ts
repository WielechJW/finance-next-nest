import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { missingSessions, previousDay, quoteFreshness } from './calendar.js';

@Injectable()
export class MarketQualityService {
  constructor(private readonly prisma: PrismaService) {}
  async quote(instrumentId: string, now = new Date(), db: Pick<Prisma.TransactionClient, 'instrument' | 'priceBar'> = this.prisma) {
    const instrument = await db.instrument.findUnique({ where: { id: instrumentId }, select: { id: true, ticker: true, mic: true, currency: true, name: true } });
    if (!instrument) throw new NotFoundException('Nie znaleziono instrumentu.');
    const price = await db.priceBar.findFirst({ where: { instrumentId, source: 'EODHD', currentSlot: 1 }, orderBy: { sessionOn: 'desc' } });
    const date = price?.sessionOn.toISOString().slice(0, 10) ?? null;
    const freshness = quoteFreshness(instrument.mic, date, now);
    const from = previousDay(freshness.expectedSessionOn, 7);
    const rows = await db.priceBar.findMany({ where: { instrumentId, source: 'EODHD', currentSlot: 1,
      sessionOn: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${freshness.expectedSessionOn}T00:00:00Z`) } }, select: { sessionOn: true } });
    return { instrument, ...freshness, missingSessions: missingSessions(instrument.mic, from, freshness.expectedSessionOn, new Set(rows.map(row => row.sessionOn.toISOString().slice(0, 10)))),
      quote: price ? { id: price.id, close: price.close.toFixed(10), currency: instrument.currency, sessionOn: date, source: price.source, revision: price.revision,
        fetchedAt: price.fetchedAt.toISOString() } : null };
  }
}
