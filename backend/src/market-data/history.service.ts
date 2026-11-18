import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { type DailyBar, type MarketAction } from './history-contracts.js';

const date = (value: string) => new Date(`${value}T00:00:00Z`);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

@Injectable()
export class MarketHistoryService {
  constructor(private readonly prisma: PrismaService) {}
  async saveBars(instrumentId: string, bars: DailyBar[], fetchedAt = new Date()) {
    return this.prisma.$transaction(async tx => {
      const lock = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Instrument" WHERE "id" = ${instrumentId}::uuid FOR UPDATE`;
      if (!lock.length) throw new NotFoundException('Nie znaleziono instrumentu.');
      for (const bar of bars) {
        const { sessionOn, ...values } = bar;
        const where = { instrumentId, source: 'EODHD', sessionOn: date(sessionOn), currentSlot: 1 };
        const current = await tx.priceBar.findFirst({ where });
        const contentHash = hash(bar);
        if (current?.contentHash === contentHash) { await tx.priceBar.update({ where: { id: current.id }, data: { fetchedAt } }); continue; }
        if (current) await tx.priceBar.update({ where: { id: current.id }, data: { currentSlot: null } });
        await tx.priceBar.create({ data: { ...where, ...values, revision: (current?.revision ?? 0) + 1, contentHash, fetchedAt } });
      }
      return { stored: bars.length };
    }, { timeout: 30000 });
  }
  async saveActions(instrumentId: string, actions: MarketAction[], fetchedAt = new Date()) {
    return this.prisma.$transaction(async tx => {
      const lock = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Instrument" WHERE "id" = ${instrumentId}::uuid FOR UPDATE`;
      if (!lock.length) throw new NotFoundException('Nie znaleziono instrumentu.');
      for (const action of actions) {
        const { exDate, paymentOn, ...values } = action;
        const where = { instrumentId, source: 'EODHD', kind: action.kind, exDate: date(exDate), currentSlot: 1 };
        const current = await tx.corporateAction.findFirst({ where });
        const contentHash = hash(action);
        if (current?.contentHash === contentHash) { await tx.corporateAction.update({ where: { id: current.id }, data: { fetchedAt } }); continue; }
        if (current) await tx.corporateAction.update({ where: { id: current.id }, data: { currentSlot: null } });
        await tx.corporateAction.create({ data: { ...where, ...values, paymentOn: paymentOn ? date(paymentOn) : null, contentHash, fetchedAt, revision: (current?.revision ?? 0) + 1 } });
      }
      return { stored: actions.length };
    });
  }
  async saveFx(rows: { sessionOn: string; rate: string; reference: string }[], fetchedAt = new Date()) {
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(51490701)`;
      for (const row of rows) {
        const where = { source: 'NBP', base: 'USD' as const, quote: 'PLN' as const, sessionOn: date(row.sessionOn), currentSlot: 1 };
        const current = await tx.fxRate.findFirst({ where });
        const contentHash = hash(row);
        if (current?.contentHash === contentHash) { await tx.fxRate.update({ where: { id: current.id }, data: { fetchedAt } }); continue; }
        if (current) await tx.fxRate.update({ where: { id: current.id }, data: { currentSlot: null } });
        await tx.fxRate.create({ data: { ...where, rate: row.rate, reference: row.reference, contentHash, fetchedAt, revision: (current?.revision ?? 0) + 1 } });
      }
      return { stored: rows.length };
    });
  }
  async prices(instrumentId: string, from: string, to: string) {
    if (!await this.prisma.instrument.findUnique({ where: { id: instrumentId }, select: { id: true } })) throw new NotFoundException('Nie znaleziono instrumentu.');
    const rows = await this.prisma.priceBar.findMany({ where: { instrumentId, source: 'EODHD', currentSlot: 1, sessionOn: { gte: date(from), lte: date(to) } }, orderBy: { sessionOn: 'asc' }, take: 366 });
    return rows.map(row => ({ id: row.id, sessionOn: row.sessionOn.toISOString().slice(0, 10), source: row.source, revision: row.revision,
      open: row.open.toFixed(10), high: row.high.toFixed(10), low: row.low.toFixed(10), close: row.close.toFixed(10),
      adjustedClose: row.adjustedClose.toFixed(10), volume: row.volume.toFixed(0), fetchedAt: row.fetchedAt.toISOString(), publishedAt: row.publishedAt?.toISOString() ?? null }));
  }
}
