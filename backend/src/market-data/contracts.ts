import { Prisma } from '../generated/prisma/client.js';

export class MarketDataError extends Error {
  constructor(readonly code: 'configuration' | 'budget' | 'rate_limit' | 'access' | 'network' | 'invalid_data' | 'not_ready', message: string) {
    super(message);
    this.name = 'MarketDataError';
  }
}
export const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MarketDataError('invalid_data', 'Niepoprawna odpowiedź dostawcy danych.');
  return value as Record<string, unknown>;
};
export function marketDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new MarketDataError('invalid_data', 'Niepoprawna data danych rynkowych.');
  }
  return value;
}
// Node 24 exposes the original numeric lexeme. Never round vendor decimals through Number.
export function parseMarketJson(text: string): unknown {
  return JSON.parse(text, (_key, value: unknown, context?: { source?: string }): unknown => {
    if (typeof value !== 'number') return value;
    if (!context?.source) throw new MarketDataError('invalid_data', 'Brak dokładnej reprezentacji liczby dostawcy.');
    return context.source;
  }) as unknown;
}
export function marketDecimal(value: unknown, scale = 10, allowZero = false): string {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) throw new MarketDataError('invalid_data', 'Niepoprawna liczba dostawcy.');
  const decimal = new Prisma.Decimal(value);
  if (!decimal.isFinite() || decimal.isNegative() || (!allowZero && decimal.isZero()) || decimal.decimalPlaces() > scale || decimal.gte(new Prisma.Decimal(10).pow(28 - scale))) {
    throw new MarketDataError('invalid_data', 'Liczba dostawcy przekracza dozwoloną precyzję.');
  }
  return decimal.toFixed(scale);
}
export type CatalogInstrument = { ticker: string; name: string | null; mic: string; currency: 'PLN' | 'USD'; isin: string | null; symbol: string };
export function parseCatalog(payload: unknown, exchange: 'WAR' | 'US'): CatalogInstrument[] {
  if (!Array.isArray(payload) || payload.length === 0) throw new MarketDataError('invalid_data', 'Brak poprawnego katalogu instrumentów.');
  const seen = new Set<string>();
  const result: CatalogInstrument[] = [];
  for (const value of payload) {
    const row = object(value);
    if (row.Type !== 'Common Stock' || row.Currency !== (exchange === 'WAR' ? 'PLN' : 'USD')) continue;
    const ticker = row.Code;
    if (typeof ticker !== 'string' || !/^[A-Z0-9][A-Z0-9.-]{0,31}$/.test(ticker)) throw new MarketDataError('invalid_data', 'Niepoprawny symbol instrumentu.');
    const mic = exchange === 'WAR' ? 'XWAR' : ({ NASDAQ: 'XNAS', NYSE: 'XNYS', 'NYSE MKT': 'XASE', AMEX: 'XASE', 'NYSE ARCA': 'ARCX' } as Record<string, string>)[String(row.Exchange)];
    // Do not invent a MIC for OTC, unknown exchanges or unsupported asset classes.
    if (!mic) continue;
    if (seen.has(ticker)) throw new MarketDataError('invalid_data', 'Powtórzony symbol w katalogu.');
    seen.add(ticker);
    const isin = typeof row.Isin === 'string' && /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(row.Isin) ? row.Isin : null;
    result.push({ ticker, mic, currency: exchange === 'WAR' ? 'PLN' : 'USD', isin,
      name: typeof row.Name === 'string' && row.Name.trim() ? row.Name.trim().slice(0, 200) : null, symbol: `${ticker}.${exchange}` });
  }
  if (!result.length) throw new MarketDataError('invalid_data', 'Katalog nie zawiera obsługiwanych akcji.');
  return result;
}
