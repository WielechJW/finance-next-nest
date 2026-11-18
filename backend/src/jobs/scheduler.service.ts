import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MarketJobsService } from './jobs.service.js';
import { expectedSession, previousDay } from '../market-data/calendar.js';

@Injectable()
export class MarketSchedulerService {
  constructor(private readonly prisma: PrismaService, private readonly jobs: MarketJobsService) {}
  async schedule(now = new Date()) {
    const to = expectedSession('XWAR', now);
    const from = previousDay(to, 7);
    await this.jobs.ensure(`fx_${to}`, 'fx', { from, to }, 1);
    const holdings = await this.prisma.securityEntry.groupBy({ by: ['instrumentId'], where: { event: { activeSlot: 1, account: { archivedAt: null } } }, _sum: { quantity: true } });
    const instruments = await this.prisma.instrument.findMany({ where: { id: { in: holdings.filter(row => row._sum.quantity?.gt(0)).map(row => row.instrumentId) }, providerMappings: { some: { provider: 'EODHD' } } }, orderBy: { id: 'asc' } });
    for (const instrument of instruments) {
      const target = expectedSession(instrument.mic, now);
      const payload = { instrumentId: instrument.id, from: previousDay(target, 7), to: target };
      await this.jobs.ensure(`prices_${instrument.id}_${target}`, 'prices', payload, 2);
      // Price jobs have priority. Corporate actions share the same guarded daily budget.
      const week = Math.floor(Date.parse(target) / (7 * 86400000));
      const actionsFrom = previousDay(target, 90);
      for (const kind of ['dividends', 'splits']) await this.jobs.ensure(`${kind}_${instrument.id}_${week}`, kind, { ...payload, from: actionsFrom }, 20);
    }
    await this.prisma.workerHeartbeat.upsert({ where: { name: 'market-data' }, create: { name: 'market-data', updatedAt: now }, update: { updatedAt: now } });
  }
}
