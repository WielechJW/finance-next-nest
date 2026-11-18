import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { MarketDataBudgetService } from './budget.service.js';
import { MarketDataError, object, parseCatalog, parseMarketJson } from './contracts.js';

@Injectable()
export class EodhdProvider {
  constructor(private readonly budget: MarketDataBudgetService) {}
  private configuration() {
    const token = process.env.EODHD_API_TOKEN?.trim();
    const limit = Number(process.env.EODHD_DAILY_BUDGET ?? '20');
    if (!token || token === 'demo' || !Number.isInteger(limit) || limit < 1 || limit > 20) throw new MarketDataError('configuration', 'Skonfiguruj własny klucz EODHD i dzienny budżet 1–20.');
    return { token, limit, keyHash: createHash('sha256').update(token).digest('hex') };
  }
  private async read(path: string, params: Record<string, string>, token: string): Promise<unknown> {
    const url = new URL(`/api/${path}`, 'https://eodhd.com');
    url.search = new URLSearchParams({ api_token: token, fmt: 'json', ...params }).toString();
    let response: Response;
    try { response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json' } }); }
    catch { throw new MarketDataError('network', 'Nie udało się połączyć z dostawcą danych.'); }
    if (!response.ok) {
      await response.body?.cancel();
      throw new MarketDataError([402, 429].includes(response.status) ? 'rate_limit' : 'access', 'Dostawca odmówił udostępnienia danych.');
    }
    try { return parseMarketJson(await response.text()); }
    catch { throw new MarketDataError('invalid_data', 'Dostawca zwrócił niepoprawne dane.'); }
  }
  async request(path: string, params: Record<string, string> = {}): Promise<unknown> {
    const { token, limit, keyHash } = this.configuration();
    const now = new Date();
    const account = object(await this.read('user', {}, token));
    const used = account.apiRequestsDate === now.toISOString().slice(0, 10) ? Number(account.apiRequests) : 0;
    const remoteLimit = Number(account.dailyRateLimit);
    if (!Number.isSafeInteger(used) || used < 0 || !Number.isSafeInteger(remoteLimit) || remoteLimit < 1) throw new MarketDataError('invalid_data', 'Nie można potwierdzić limitu danych.');
    const wait = await this.budget.reserve(keyHash, used, Math.min(limit, remoteLimit), now);
    if (wait) await pause(wait);
    try { return await this.read(path, params, token); }
    catch (error) {
      if (error instanceof MarketDataError && error.code === 'rate_limit') await this.budget.block(keyHash, new Date(Date.now() + 60_000));
      throw error;
    }
  }
  async catalog(exchange: 'WAR' | 'US') { return parseCatalog(await this.request(`exchange-symbol-list/${exchange}`), exchange); }
}
