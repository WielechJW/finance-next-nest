import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { marketDecimal } from '../market-data/contracts.js';
import { MarketQualityService } from '../market-data/quality.service.js';
import { alertTransition } from './transition.js';

export type AlertInput = { instrumentId: string; direction: 'ABOVE' | 'BELOW'; mode: 'ONCE' | 'REARM'; threshold: string; cooldownMinutes: number };
@Injectable()
export class PriceAlertsService {
  constructor(private readonly prisma: PrismaService, private readonly quality: MarketQualityService) {}
  private serialize(row: { id: string; instrumentId: string; instrument: { ticker: string; currency: string }; threshold: { toString(): string }; direction: string; mode: string; active: boolean; armed: boolean; cooldownMinutes: number }) {
    return { id: row.id, instrumentId: row.instrumentId, ticker: row.instrument.ticker, currency: row.instrument.currency, threshold: row.threshold.toString(), direction: row.direction, mode: row.mode, active: row.active, armed: row.armed, cooldownMinutes: row.cooldownMinutes };
  }
  async list(userId: string) { return (await this.prisma.priceAlert.findMany({ where: { userId, deletedAt: null }, include: { instrument: true }, orderBy: { createdAt: 'asc' } })).map(row => this.serialize(row)); }
  async create(userId: string, input: AlertInput) {
    let threshold: string; try { threshold = marketDecimal(input.threshold); } catch { throw new BadRequestException('Próg musi być dodatnią liczbą o prawidłowej precyzji.'); }
    const quote = await this.quality.quote(input.instrumentId);
    const baseline = quote.status === 'fresh' && quote.quote ? alertTransition({ ...input, threshold: { toString: () => threshold }, armed: false, lastSatisfied: null, lastSessionOn: null, lastTriggeredAt: null, active: true }, quote.quote.close, quote.quote.sessionOn!, new Date()) : null;
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
      if (await tx.priceAlert.count({ where: { userId, deletedAt: null } }) >= 100) throw new BadRequestException('Możesz mieć najwyżej 100 reguł alertów.');
      const row = await tx.priceAlert.create({ data: { ...input, threshold, userId,
        ...(baseline && quote.quote ? { armed: baseline.armed, lastSatisfied: baseline.satisfied, lastSessionOn: new Date(`${quote.quote.sessionOn}T00:00:00Z`), lastPriceBarId: quote.quote.id } : {}) }, include: { instrument: true } });
      return this.serialize(row);
    });
  }
  async update(userId: string, id: string, active: boolean) {
    const row = await this.prisma.priceAlert.findFirst({ where: { id, userId, deletedAt: null } });
    if (!row) throw new NotFoundException('Nie znaleziono reguły alertu.');
    return this.serialize(await this.prisma.priceAlert.update({ where: { id, userId }, data: { active, armed: false, lastSatisfied: null, lastSessionOn: null, lastPriceBarId: null }, include: { instrument: true } }));
  }
  async remove(userId: string, id: string) {
    const result = await this.prisma.priceAlert.updateMany({ where: { id, userId, deletedAt: null }, data: { active: false, deletedAt: new Date() } });
    if (!result.count) throw new NotFoundException('Nie znaleziono reguły alertu.');
  }
  async evaluateInstrument(instrumentId: string, now = new Date()) {
    const data = await this.quality.quote(instrumentId, now);
    if (data.status !== 'fresh' || !data.quote) return { fired: 0 };
    const quote = data.quote;
    const rules = await this.prisma.priceAlert.findMany({ where: { instrumentId, active: true, deletedAt: null }, select: { id: true } });
    let fired = 0;
    for (const rule of rules) fired += await this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT "id" FROM "PriceAlert" WHERE "id" = ${rule.id}::uuid FOR UPDATE`;
      const row = await tx.priceAlert.findUnique({ where: { id: rule.id } });
      if (!row || !row.active || row.deletedAt || row.lastPriceBarId === quote.id) return 0;
      const transition = alertTransition(row, quote.close, quote.sessionOn!, now);
      if (transition.skip) return 0;
      await tx.priceAlert.update({ where: { id: row.id }, data: { armed: transition.armed, active: transition.active,
        lastSatisfied: transition.satisfied, lastSessionOn: new Date(`${quote.sessionOn}T00:00:00Z`), lastPriceBarId: quote.id,
        ...(transition.fire ? { lastTriggeredAt: now } : {}) } });
      if (!transition.fire) return 0;
      const event = await tx.alertEvent.upsert({ where: { alertId_sessionOn: { alertId: row.id, sessionOn: new Date(`${quote.sessionOn}T00:00:00Z`) } },
        create: { alertId: row.id, priceBarId: quote.id, sessionOn: new Date(`${quote.sessionOn}T00:00:00Z`), price: quote.close, threshold: row.threshold, direction: row.direction }, update: {} });
      await tx.marketJob.upsert({ where: { key: `notification_${event.id}` }, create: { key: `notification_${event.id}`, kind: 'notification', payload: { eventId: event.id }, priority: 5 }, update: {} });
      return 1;
    });
    return { fired };
  }
  async history(userId: string, page: number) {
    const where = { alert: { userId } };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.alertEvent.findMany({ where, include: { alert: { include: { instrument: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 25, take: 25 }), this.prisma.alertEvent.count({ where }),
    ], { isolationLevel: 'RepeatableRead' });
    return { total, page, pageSize: 25, items: rows.map(row => ({ id: row.id, alertId: row.alertId, instrumentId: row.alert.instrumentId, ticker: row.alert.instrument.ticker,
      currency: row.alert.instrument.currency, sessionOn: row.sessionOn.toISOString().slice(0, 10), price: row.price.toFixed(10), threshold: row.threshold.toFixed(10), direction: row.direction, createdAt: row.createdAt.toISOString() })) };
  }
}
