import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { EodhdProvider } from './eodhd.provider.js';
import { MarketDataError, marketDate, parseMarketJson } from './contracts.js';
import { parseActions, parseBars, parseNbp } from './history-contracts.js';
import { MarketHistoryService } from './history.service.js';

@Injectable()
export class MarketSyncService {
  constructor(private readonly prisma: PrismaService, private readonly provider: EodhdProvider, private readonly history: MarketHistoryService) {}
  async instrument(instrumentId: string, kind: 'prices' | 'dividends' | 'splits', from: string, to: string) {
    marketDate(from); marketDate(to);
    if (from > to || Date.parse(to) - Date.parse(from) > 365 * 86400000) throw new MarketDataError('configuration', 'Zakres danych musi mieścić się w roku.');
    const mapping = await this.prisma.instrumentProviderMapping.findUnique({ where: { instrumentId_provider: { instrumentId, provider: 'EODHD' } }, include: { instrument: true } });
    if (!mapping) throw new NotFoundException('Brak mapowania instrumentu do dostawcy.');
    const endpoint = { prices: 'eod', dividends: 'div', splits: 'splits' }[kind];
    const payload = await this.provider.request(`${endpoint}/${encodeURIComponent(mapping.symbol)}`, { from, to, ...(kind === 'prices' ? { period: 'd', order: 'a' } : {}) });
    return kind === 'prices' ? this.history.saveBars(instrumentId, parseBars(payload, from, to)) : this.history.saveActions(instrumentId, parseActions(payload, kind === 'dividends' ? 'DIVIDEND' : 'SPLIT', mapping.instrument.currency));
  }
  async fx(from: string, to: string) {
    marketDate(from); marketDate(to);
    if (from > to || Date.parse(to) - Date.parse(from) > 92 * 86400000) throw new MarketDataError('configuration', 'Zakres NBP musi mieścić się w 93 dniach.');
    try {
      const response = await fetch(`https://api.nbp.pl/api/exchangerates/rates/a/usd/${from}/${to}/?format=json`, { redirect: 'error', signal: AbortSignal.timeout(20000) });
      if (response.status === 404) { await response.body?.cancel(); return { stored: 0 }; }
      if (!response.ok) { await response.body?.cancel(); throw new MarketDataError('network', 'NBP nie udostępnił kursów walut.'); }
      return await this.history.saveFx(parseNbp(parseMarketJson(await response.text())));
    } catch (error) {
      if (error instanceof MarketDataError) throw error;
      throw new MarketDataError('network', 'Nie udało się pobrać kursów NBP.');
    }
  }
}
