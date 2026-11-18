import { setTimeout as delay } from 'node:timers/promises';
import { SAMPLE, summarizeSeries } from './verify-eodhd.mjs';

// This probe never spends welcome/purchased extra calls or requests paid fundamentals.
export async function runFreeProbe({ token, fetchImpl = fetch, pause = delay, now = new Date(), maxCalls = 12 }) {
  if (!token?.trim() || token === 'demo') throw new Error('Wymagany własny EODHD_API_TOKEN.');
  if (!Number.isInteger(maxCalls) || maxCalls < 0 || maxCalls > 20) throw new Error('Budżet musi być w zakresie 0–20.');
  const report = { provider: 'EODHD', checkedAt: now.toISOString(), mode: 'configured_free_key', rawDataStored: false,
    maxCallUnits: maxCalls, callUnitsReserved: 0, catalogs: {}, instruments: [], fundamentals: { status: 'not_requested_free_plan' } };
  let requests = 0;
  let stopped = false;
  const numeric = value => (typeof value === 'number' || typeof value === 'string') && /^\d+$/.test(String(value)) ? Number(value) : null;
  async function request(path, params = {}, cost = 1) {
    if (stopped) return { status: 'skipped_after_error' };
    if (cost && report.callUnitsReserved + cost > report.allowedCallUnits) return { status: 'skipped_budget' };
    if (requests++) await pause(3200);
    report.callUnitsReserved += cost;
    const url = new URL(path, 'https://eodhd.com');
    url.search = new URLSearchParams({ api_token: token, fmt: 'json', ...params }).toString();
    try {
      const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json' } });
      if (!response.ok) {
        await response.body?.cancel();
        if ([401, 402, 429].includes(response.status)) stopped = true;
        return { status: response.status === 403 ? 'access_denied' : 'http_error', httpStatus: response.status };
      }
      try { return { status: 'received', httpStatus: response.status, payload: await response.json() }; }
      catch { return { status: 'invalid_payload', httpStatus: response.status }; }
    } catch { stopped = true; return { status: 'network_error' }; }
  }
  const before = await request('/api/user', {}, 0);
  if (before.status !== 'received') return { ...report, account: before };
  const used = numeric(before.payload.apiRequests);
  const limit = numeric(before.payload.dailyRateLimit);
  const date = typeof before.payload.apiRequestsDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(before.payload.apiRequestsDate) ? before.payload.apiRequestsDate : null;
  if (used === null || limit === null) return { ...report, account: { status: 'invalid_payload' } };
  report.account = { status: 'available', dailyRateLimit: limit, apiRequests: used, apiRequestsDate: date };
  // A stale counter may overestimate usage; conservatively wait for a later run.
  report.allowedCallUnits = Math.min(maxCalls, Math.max(0, limit - used));
  const catalogs = {};
  for (const exchange of ['WAR', 'US']) {
    const result = await request(`/api/exchange-symbol-list/${exchange}`);
    if (result.status === 'received') {
      const valid = Array.isArray(result.payload) && result.payload.every(row => row && typeof row.Code === 'string');
      report.catalogs[exchange] = { status: valid ? 'available' : 'invalid_payload', httpStatus: result.httpStatus };
      if (valid) catalogs[exchange] = result.payload;
    } else report.catalogs[exchange] = result;
  }
  const end = new Date(now); end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - 14);
  report.window = { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  for (const instrument of SAMPLE) {
    const symbol = `${instrument.code}.${instrument.exchange}`;
    const match = catalogs[instrument.exchange]?.find(row => row.Code === instrument.code);
    const result = await request(`/api/eod/${symbol}`, { ...report.window, period: 'd', order: 'a' });
    report.instruments.push({ symbol, expectedCurrency: instrument.currency,
      identity: { status: match ? (match.Currency === instrument.currency && match.Type === 'Common Stock' ? 'available' : 'invalid_payload') : 'unverified',
        currencyMatches: match?.Currency === instrument.currency, hasIsin: typeof match?.Isin === 'string' && match.Isin.length > 0 },
      eod: result.status === 'received' ? { httpStatus: result.httpStatus, ...summarizeSeries('eod', result.payload) } : result });
  }
  report.pricesAndIdentityComplete = report.instruments.every(row => row.identity.status === 'available' && row.eod.status === 'available');
  report.fullProviderVerificationComplete = false;
  report.requestsMade = requests;
  return report;
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--max-calls')) throw new Error();
    const report = await runFreeProbe({ token: process.env.EODHD_API_TOKEN, maxCalls: args.length ? Number(args[1]) : 12 });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.pricesAndIdentityComplete ? 0 : 2;
  } catch { process.stderr.write('Ustaw własny EODHD_API_TOKEN; opcja: --max-calls 0–20.\n'); process.exitCode = 1; }
}
