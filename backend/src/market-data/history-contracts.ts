import { Prisma } from '../generated/prisma/client.js';
import { MarketDataError, marketDate, marketDecimal, object } from './contracts.js';

export type DailyBar = { sessionOn: string; open: string; high: string; low: string; close: string; adjustedClose: string; volume: string };
export type MarketAction = { kind: 'SPLIT' | 'DIVIDEND'; exDate: string; paymentOn: string | null; currency: 'PLN' | 'USD' | null;
  amount: string | null; amountBasis: string | null; numerator: string | null; denominator: string | null };
function rows(payload: unknown): unknown[] {
  if (!Array.isArray(payload)) throw new MarketDataError('invalid_data', 'Niepoprawna seria danych rynkowych.');
  return payload as unknown[];
}
function uniqueDates<T>(values: T[], key: (value: T) => string): T[] {
  if (new Set(values.map(key)).size !== values.length) throw new MarketDataError('invalid_data', 'Powtórzone daty w serii dostawcy wymagają sprawdzenia.');
  return values;
}
export function parseBars(payload: unknown, from: string, to: string): DailyBar[] {
  marketDate(from); marketDate(to);
  return uniqueDates(rows(payload).map(value => {
    const row = object(value);
    const sessionOn = marketDate(row.date);
    if (sessionOn < from || sessionOn > to) throw new MarketDataError('invalid_data', 'Cena poza zakresem pobierania.');
    const bar = { sessionOn, open: marketDecimal(row.open), high: marketDecimal(row.high), low: marketDecimal(row.low),
      close: marketDecimal(row.close), adjustedClose: marketDecimal(row.adjusted_close), volume: marketDecimal(row.volume, 0, true) };
    const high = new Prisma.Decimal(bar.high), low = new Prisma.Decimal(bar.low);
    if (high.lt(bar.open) || high.lt(bar.close) || low.gt(bar.open) || low.gt(bar.close) || low.gt(high)) throw new MarketDataError('invalid_data', 'Niespójne wartości OHLC.');
    return bar;
  }), row => row.sessionOn);
}
export function parseActions(payload: unknown, kind: 'SPLIT' | 'DIVIDEND', currency: 'PLN' | 'USD'): MarketAction[] {
  return uniqueDates(rows(payload).map(value => {
    const row = object(value);
    const exDate = marketDate(row.date);
    if (kind === 'SPLIT') {
      if (typeof row.split !== 'string' || !/^\d+(?:\.\d+)?\/\d+(?:\.\d+)?$/.test(row.split)) throw new MarketDataError('invalid_data', 'Niepoprawna proporcja splitu.');
      const [n, d] = row.split.split('/');
      return { kind, exDate, paymentOn: null, currency: null, amount: null, amountBasis: null, numerator: marketDecimal(n), denominator: marketDecimal(d) };
    }
    if (row.currency !== currency) throw new MarketDataError('invalid_data', 'Niepotwierdzona waluta dywidendy.');
    return { kind, exDate, paymentOn: row.paymentDate ? marketDate(row.paymentDate) : null, currency,
      amount: marketDecimal(row.unadjustedValue ?? row.value, 8, true),
      amountBasis: row.unadjustedValue !== undefined ? 'unadjusted' : 'provider_value', numerator: null, denominator: null };
  }), row => row.exDate);
}
export function parseNbp(payload: unknown) {
  const data = object(payload);
  if (data.code !== 'USD' || data.table !== 'A') throw new MarketDataError('invalid_data', 'Niepoprawna tabela walut NBP.');
  return uniqueDates(rows(data.rates).map(value => {
    const row = object(value);
    if (typeof row.no !== 'string' || !row.no || row.no.length > 80) throw new MarketDataError('invalid_data', 'Brak identyfikatora tabeli NBP.');
    return { sessionOn: marketDate(row.effectiveDate), rate: marketDecimal(row.mid, 8), reference: row.no };
  }), row => row.sessionOn);
}
