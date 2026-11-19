import { ApiError, apiRequest } from './api-client';
import { investmentAccountPath } from './investments-api';

export function marketObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(502, 'Nieprawidłowe dane rynkowe.');
  return value as Record<string, unknown>;
}
export function marketText(value: unknown): string { if (typeof value !== 'string') throw new ApiError(502, 'Nieprawidłowy tekst odpowiedzi.'); return value; }
export function marketDecimal(value: unknown): string { const text = marketText(value); if (!/^-?\d{1,60}(?:\.\d{1,10})?$/.test(text)) throw new ApiError(502, 'Nieprawidłowa wartość liczbowa.'); return text; }
export function marketNullableDecimal(value: unknown): string | null { return value === null ? null : marketDecimal(value); }
export function marketArray<T>(value: unknown, parse: (item: unknown) => T): T[] { if (!Array.isArray(value)) throw new ApiError(502, 'Nieprawidłowa lista danych.'); return value.map(parse); }
export function marketInteger(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new ApiError(502, 'Nieprawidłowy licznik.'); return value; }
export function marketBoolean(value: unknown): boolean { if (typeof value !== 'boolean') throw new ApiError(502, 'Nieprawidłowy stan danych.'); return value; }
const money = (value: unknown) => { const row = marketObject(value); return { PLN: marketDecimal(row.PLN), USD: marketDecimal(row.USD) }; };
function pendingSplits(value: unknown) {
  return marketArray(value ?? [], item => { const split = marketObject(item); return { ticker: marketText(split.ticker), exDate: marketText(split.exDate) }; });
}
function valuation(value: unknown) {
  const row = marketObject(value);
  return { asOf: marketText(row.asOf), pendingSplits: pendingSplits(row.pendingSplits), complete: marketBoolean(row.complete), valuePln: marketNullableDecimal(row.valuePln), resultPln: marketNullableDecimal(row.resultPln),
    netContributionsPln: marketNullableDecimal(row.netContributionsPln), cash: money(row.cash), realized: money(row.realized), dividendsGross: money(row.dividendsGross), feesAndTaxes: money(row.feesAndTaxes),
    allocation: (() => { const a = marketObject(row.allocation); const parse = (value: unknown) => { const r = marketObject(value); return { label: marketText(r.label), percent: marketNullableDecimal(r.percent) }; }; return { markets: marketArray(a.markets, parse), currencies: marketArray(a.currencies, parse) }; })(),
    positions: marketArray(row.positions, value => { const p = marketObject(value), i = marketObject(p.instrument), q = p.quote === null ? null : marketObject(p.quote);
      return { id: marketText(i.id), ticker: marketText(i.ticker), mic: marketText(i.mic), currency: marketText(i.currency), quantity: marketDecimal(p.quantity), cost: marketDecimal(p.cost), status: marketText(p.status),
        value: marketNullableDecimal(p.value), valuePln: marketNullableDecimal(p.valuePln), unrealized: marketNullableDecimal(p.unrealized), allocationPercent: marketNullableDecimal(p.allocationPercent),
        quote: q ? { sessionOn: marketText(q.sessionOn), source: marketText(q.source) } : null }; }) };
}
function action(value: unknown) {
  const row = marketObject(value), instrument = marketObject(row.instrument);
  const kind = marketText(row.kind);
  if (!['SPLIT', 'DIVIDEND'].includes(kind)) throw new ApiError(502, 'Nieprawidłowy typ zdarzenia.');
  return { id: marketText(row.id), revision: marketInteger(row.revision), kind, ticker: marketText(instrument.ticker), currency: marketText(instrument.currency),
    exDate: marketText(row.exDate), paymentOn: row.paymentOn === null ? null : marketText(row.paymentOn), suggestedGrossAmount: marketNullableDecimal(row.suggestedGrossAmount),
    numerator: marketNullableDecimal(row.numerator), denominator: marketNullableDecimal(row.denominator), recordedEventId: row.recordedEventId === null ? null : marketText(row.recordedEventId), recordedRevisionDiffers: marketBoolean(row.recordedRevisionDiffers) };
}
export type CorporateActionProposal = ReturnType<typeof action>;
export const investmentMarketApi = {
  valuation: async (portfolioId: string, signal?: AbortSignal) => valuation(await apiRequest<unknown>(`/investments/portfolios/${encodeURIComponent(portfolioId)}/valuation`, { signal })),
  history: async (portfolioId: string, from: string, to: string, signal?: AbortSignal) => {
    const data = marketObject(await apiRequest<unknown>(`/investments/portfolios/${encodeURIComponent(portfolioId)}/valuations?${new URLSearchParams({ from, to })}`, { signal }));
    return { twrPercent: marketNullableDecimal(data.twrPercent), items: marketArray(data.items, value => { const row = marketObject(value); return { asOf: marketText(row.asOf), pendingSplits: pendingSplits(row.pendingSplits), valuePln: marketNullableDecimal(row.valuePln), resultPln: marketNullableDecimal(row.resultPln) }; }) };
  },
  actions: async (p: string, a: string, signal?: AbortSignal) => marketArray(await apiRequest<unknown>(`${investmentAccountPath(p, a)}/corporate-actions`, { signal }), action),
  confirmAction: (p: string, a: string, actionId: string, data: unknown) => apiRequest(`${investmentAccountPath(p, a)}/corporate-actions/${encodeURIComponent(actionId)}/confirm`, { method: 'POST', body: JSON.stringify(data) }),
};
