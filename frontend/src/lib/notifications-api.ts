import { apiRequest } from './api-client';
import { marketObject as object, marketText as text, marketBoolean as bool, marketInteger as integer, marketArray as array } from './investment-market-api';
function status(value: unknown) { const r = object(value); return { configured: bool(r.configured), connected: bool(r.connected), quietStart: integer(r.quietStart), quietEnd: integer(r.quietEnd), timeZone: text(r.timeZone), dailySummaryEnabled: bool(r.dailySummaryEnabled) }; }
const write = (path: string, body: unknown, method = 'POST') => apiRequest<unknown>(path, { method, body: JSON.stringify(body) });
export const notificationsApi = {
  status: async (signal?: AbortSignal) => status(await apiRequest<unknown>('/notifications/telegram', { signal })),
  pair: async () => { const r = object(await write('/notifications/telegram/pairing', {})); return { code: text(r.code), expiresAt: text(r.expiresAt), url: r.url === null ? null : text(r.url) }; },
  disconnect: () => apiRequest('/notifications/telegram', { method: 'DELETE' }),
  settings: (data: { quietStart: number; quietEnd: number; timeZone: string; dailySummaryEnabled: boolean }) => write('/notifications/telegram', data, 'PATCH'),
  history: async (page: number, signal?: AbortSignal) => { const r = object(await apiRequest<unknown>(`/notifications?page=${page}`, { signal })); return { total: integer(r.total), items: array(r.items, value => { const n = object(value); return { id: text(n.id), body: text(n.body), state: text(n.state), attempts: integer(n.attempts), createdAt: text(n.createdAt) }; }) }; },
  retry: (id: string, acknowledgeDuplicateRisk: boolean) => write(`/notifications/${encodeURIComponent(id)}/retry`, { acknowledgeDuplicateRisk }),
};
