import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MarketJobsService } from './jobs.service.js';
import { MarketDataError } from '../market-data/contracts.js';
import { createHash } from 'node:crypto';
import { replayBalances } from '../investments/posting.js';
import { expectedSession, previousDay, zonedClock } from '../market-data/calendar.js';

@Injectable()
export class MarketSchedulerService {
  constructor(private readonly prisma: PrismaService, private readonly jobs: MarketJobsService) {}
  async schedule(now = new Date()) {
    const sessions = new Map<string, string | null>();
    function targetSession(mic: string) {
      if (!sessions.has(mic)) {
        try { sessions.set(mic, expectedSession(mic, now)); }
        catch (error) {
          if (!(error instanceof MarketDataError) || error.code !== 'configuration') throw error;
          console.warn('Pominięto rynek z niepełnym kalendarzem.', mic);
          sessions.set(mic, null);
        }
      }
      return sessions.get(mic);
    }
    const to = targetSession('XWAR');
    if (to) await this.jobs.ensure(`fx_${to}`, 'fx', { from: previousDay(to, 7), to }, 1);
    const accounts = await this.prisma.investmentAccount.findMany({ include: { events: { where: { activeSlot: 1 }, include: { cashEntries: true, securityEntries: true, split: true } } } });
    const held = new Set<string>();
    const invalidPortfolios = new Set<string>();
    for (const account of accounts) {
      try {
        const { securities } = replayBalances(account.events);
        for (const [id, quantity] of Object.entries(securities)) if (!/^0(?:\.0+)?$/.test(quantity)) held.add(id);
      } catch {
        invalidPortfolios.add(account.portfolioId);
        console.warn('Rachunek wymaga uzgodnienia historii.', account.id);
      }
    }
    const watched = await this.prisma.watchlistItem.findMany({ select: { instrumentId: true } });
    const alerted = await this.prisma.priceAlert.findMany({ where: { active: true, deletedAt: null }, select: { instrumentId: true } });
    const selected = new Set([...held, ...watched.map(row => row.instrumentId), ...alerted.map(row => row.instrumentId)]);
    const latest = await this.prisma.priceBar.findMany({ where: { instrumentId: { in: [...selected] }, currentSlot: 1, source: 'EODHD' }, distinct: ['instrumentId'], orderBy: [{ instrumentId: 'asc' }, { sessionOn: 'desc' }], select: { instrumentId: true, sessionOn: true } });
    const instruments = await this.prisma.instrument.findMany({ where: { id: { in: [...selected] }, providerMappings: { some: { provider: 'EODHD' } } }, orderBy: { id: 'asc' } });
    instruments.sort((a, b) => Number(held.has(b.id)) - Number(held.has(a.id)) || (latest.find(row => row.instrumentId === a.id)?.sessionOn.getTime() ?? 0) - (latest.find(row => row.instrumentId === b.id)?.sessionOn.getTime() ?? 0));
    let rank = 0;
    for (const instrument of instruments) {
      const target = targetSession(instrument.mic);
      if (!target) continue;
      const payload = { instrumentId: instrument.id, from: previousDay(target, 7), to: target, scheduled: true };
      await this.jobs.ensure(`prices_${instrument.id}_${target}`, 'prices', payload, held.has(instrument.id) ? 2 : 10 + rank++);
      // Price jobs have priority. Corporate actions share the same guarded daily budget.
      const week = Math.floor(Date.parse(target) / (7 * 86400000));
      const actionsFrom = previousDay(target, 90);
      for (const kind of ['dividends', 'splits']) await this.jobs.ensure(`${kind}_${instrument.id}_${week}`, kind, { ...payload, from: actionsFrom }, 20);
    }
    const portfolios = await this.prisma.portfolio.findMany({ select: { id: true, userId: true, accounts: { select: { events: { where: { activeSlot: 1 }, select: { id: true, revision: true }, orderBy: { id: 'asc' } } } } } });
    const prices = await this.prisma.priceBar.findMany({ where: { currentSlot: 1 }, select: { id: true }, orderBy: { id: 'asc' } });
    const fx = await this.prisma.fxRate.findMany({ where: { currentSlot: 1 }, select: { id: true }, orderBy: { id: 'asc' } });
    const splits = await this.prisma.corporateAction.findMany({ where: { kind: 'SPLIT', currentSlot: 1 }, select: { id: true }, orderBy: { id: 'asc' } });
    const asOf = zonedClock(now, 'Europe/Warsaw').day;
    for (const portfolio of portfolios) {
      if (invalidPortfolios.has(portfolio.id)) continue;
      const signature = createHash('sha256').update(JSON.stringify([portfolio.accounts, prices, fx, splits])).digest('hex').slice(0, 20);
      await this.jobs.ensure(`valuation_${portfolio.id}_${asOf}_${signature}`, 'valuation', { portfolioId: portfolio.id, userId: portfolio.userId, asOf }, 30);
    }
  }
  async heartbeat(now = new Date()) {
    await this.prisma.workerHeartbeat.upsert({ where: { name: 'market-data' }, create: { name: 'market-data', updatedAt: now }, update: { updatedAt: now } });
  }
}
