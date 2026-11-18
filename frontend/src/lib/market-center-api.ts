import { apiRequest } from './api-client';
import { marketArray as array, marketBoolean as boolean, marketDecimal as decimal, marketInteger as integer, marketObject as object, marketText as text } from './investment-market-api';

function instrument(value: unknown) { const i = object(value); return { id: text(i.id), ticker: text(i.ticker), mic: text(i.mic), currency: text(i.currency), name: i.name === null ? null : text(i.name) }; }
function quote(value: unknown) { if (value === null) return null; const q = object(value); return { close: decimal(q.close), sessionOn: text(q.sessionOn), source: text(q.source) }; }
function list(value: unknown) { const row = object(value); return { id: text(row.id), name: text(row.name), items: array(row.items, item => { const i = object(item); return { instrument: instrument(i.instrument), quote: quote(i.quote), status: text(i.status) }; }) }; }
function alert(value: unknown) { const row = object(value); return { id: text(row.id), instrumentId: text(row.instrumentId), ticker: text(row.ticker), currency: text(row.currency), threshold: decimal(row.threshold), direction: text(row.direction), mode: text(row.mode), active: boolean(row.active) }; }
const write = (path: string, body: unknown, method = 'POST') => apiRequest<unknown>(path, { method, body: JSON.stringify(body) });
export const marketCenterApi = {
  search: async (q: string, signal?: AbortSignal) => { const r = object(await apiRequest<unknown>(`/market-data/instruments?${new URLSearchParams({ q, pageSize: '25' })}`, { signal })); return array(r.items, instrument); },
  lists: async (signal?: AbortSignal) => array(await apiRequest<unknown>('/watchlists', { signal }), list),
  createList: (name: string) => write('/watchlists', { name }),
  removeList: (id: string) => apiRequest(`/watchlists/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  addItem: (id: string, instrumentId: string) => write(`/watchlists/${encodeURIComponent(id)}/items`, { instrumentId }),
  removeItem: (id: string, instrumentId: string) => apiRequest(`/watchlists/${encodeURIComponent(id)}/items/${encodeURIComponent(instrumentId)}`, { method: 'DELETE' }),
  alerts: async (signal?: AbortSignal) => array(await apiRequest<unknown>('/price-alerts', { signal }), alert),
  createAlert: (data: { instrumentId: string; direction: string; mode: string; threshold: string; cooldownMinutes: number }) => write('/price-alerts', data),
  active: (id: string, active: boolean) => write(`/price-alerts/${encodeURIComponent(id)}`, { active }, 'PATCH'),
  removeAlert: (id: string) => apiRequest(`/price-alerts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  events: async (page = 1, signal?: AbortSignal) => { const r = object(await apiRequest<unknown>(`/price-alerts/events?page=${page}`, { signal })); return { total: integer(r.total), items: array(r.items, value => { const row = object(value); return { id: text(row.id), ticker: text(row.ticker), price: decimal(row.price), threshold: decimal(row.threshold), currency: text(row.currency), sessionOn: text(row.sessionOn) }; }) }; },
  detail: async (id: string, from: string, to: string, signal?: AbortSignal) => {
    const path = `/market-data/instruments/${encodeURIComponent(id)}`;
    const [raw, prices] = await Promise.all([apiRequest<unknown>(`${path}/quote`, { signal }), apiRequest<unknown>(`${path}/prices?${new URLSearchParams({ from, to })}`, { signal })]);
    const row = object(raw); return { instrument: instrument(row.instrument), quote: quote(row.quote), status: text(row.status), expectedSessionOn: text(row.expectedSessionOn),
      prices: array(prices, value => { const p = object(value); return { sessionOn: text(p.sessionOn), close: decimal(p.close) }; }) };
  },
};
