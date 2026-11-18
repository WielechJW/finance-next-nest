import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MarketJobsService } from './jobs.service.js';

@Injectable()
export class MarketSchedulerService {
  constructor(private readonly prisma: PrismaService, private readonly jobs: MarketJobsService) {}
  async schedule(now = new Date()) {
    const target = new Date(now); target.setUTCDate(target.getUTCDate() - 1);
    const to = target.toISOString().slice(0, 10);
    const from = new Date(target.getTime() - 7 * 86400000).toISOString().slice(0, 10);
    await this.jobs.ensure(`fx_${to}`, 'fx', { from, to }, 1);
    const holdings = await this.prisma.securityEntry.groupBy({ by: ['instrumentId'], where: { event: { activeSlot: 1, account: { archivedAt: null } } }, _sum: { quantity: true } });
    const instruments = await this.prisma.instrument.findMany({ where: { id: { in: holdings.filter(row => row._sum.quantity?.gt(0)).map(row => row.instrumentId) }, providerMappings: { some: { provider: 'EODHD' } } }, orderBy: { id: 'asc' } });
    for (const instrument of instruments) {
      const payload = { instrumentId: instrument.id, from, to };
      await this.jobs.ensure(`prices_${instrument.id}_${to}`, 'prices', payload, 2);
      // Price jobs have priority. Corporate actions share the same guarded daily budget.
      const week = Math.floor(target.getTime() / (7 * 86400000));
      const actionsFrom = new Date(target.getTime() - 90 * 86400000).toISOString().slice(0, 10);
      for (const kind of ['dividends', 'splits']) await this.jobs.ensure(`${kind}_${instrument.id}_${week}`, kind, { ...payload, from: actionsFrom }, 20);
    }
    await this.prisma.workerHeartbeat.upsert({ where: { name: 'market-data' }, create: { name: 'market-data', updatedAt: now }, update: { updatedAt: now } });
  }
}
