import { setTimeout as delay } from 'node:timers/promises';

// Fixed windows make successive runs comparable. This is a research probe,
// not the application's future Decimal-based market-data adapter.
export const WINDOWS = {
  eod: { from: '2026-11-02', to: '2026-11-13' },
  actions: { from: '2020-01-01', to: '2026-11-13' },
};

export const SAMPLE = [
  ...['CDR', 'PKN', 'PKO', 'PZU', 'KGH'].map((code) => ({
    code,
    exchange: 'WAR',
    currency: 'PLN',
  })),
  ...['AAPL', 'MSFT', 'TSLA', 'AMZN', 'MCD'].map((code) => ({
    code,
    exchange: 'US',
    currency: 'USD',
  })),
];

const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isDecimal = (value) =>
  (typeof value === 'number' && Number.isFinite(value)) ||
  (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value));
const isDate = (value) =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;

export function summarizeSeries(kind, payload) {
  if (!Array.isArray(payload)) return { status: 'invalid_payload' };
  if (payload.length === 0) return { status: 'empty', rows: 0 };
  const valid = payload.every((row) => {
    if (!isObject(row) || !isDate(row.date)) return false;
    if (kind === 'eod') {
      return (
        ['open', 'high', 'low', 'close', 'adjusted_close'].every((field) =>
          isDecimal(row[field]),
        ) &&
        Number.isSafeInteger(row.volume) &&
        row.volume >= 0
      );
    }
    if (kind === 'splits')
      return (
        typeof row.split === 'string' &&
        /^\d+(?:\.\d+)?\/\d+(?:\.\d+)?$/.test(row.split) &&
        row.split.split('/').every((part) => /[1-9]/.test(part))
      );
    return (
      isDecimal(row.value) &&
      typeof row.currency === 'string' &&
      /^[A-Z]{3}$/.test(row.currency)
    );
  });
  if (!valid) return { status: 'invalid_payload', rows: payload.length };
  const result = { status: 'available', rows: payload.length };
  if (kind === 'div') {
    result.hasUnadjustedValue = payload.every((row) =>
      isDecimal(row.unadjustedValue),
    );
    result.hasPaymentDate = payload.every((row) => isDate(row.paymentDate));
  }
  return result;
}

export function summarizeFundamentals(payload, instrument) {
  if (
    !isObject(payload) ||
    !isObject(payload.General) ||
    payload.General.Code !== instrument.code ||
    payload.General.CurrencyCode !== instrument.currency
  ) {
    return { status: 'invalid_payload' };
  }
  const statements = {};
  for (const name of ['Balance_Sheet', 'Income_Statement', 'Cash_Flow']) {
    const statement = payload.Financials?.[name];
    statements[name] = Object.fromEntries(
      ['yearly', 'quarterly'].map((period) => [
        period,
        isObject(statement?.[period])
          ? Object.values(statement[period]).filter(
              (row) =>
                isObject(row) &&
                isDate(row.date) &&
                Object.entries(row).some(
                  ([key, value]) =>
                    !['date', 'filing_date', 'currency_symbol'].includes(key) &&
                    isDecimal(value),
                ),
            ).length
          : 0,
      ]),
    );
  }
  return {
    status: Object.values(statements).every((counts) => counts.yearly > 0)
      ? 'available'
      : 'incomplete',
    currencyMatches: true,
    statements,
  };
}

export async function runProbe({ token, fetchImpl = fetch, pause = delay }) {
  if (typeof token !== 'string' || token.trim() === '') {
    throw new Error('Ustaw EODHD_API_TOKEN albo podaj --demo.');
  }
  const report = {
    provider: 'EODHD',
    checkedAt: new Date().toISOString(),
    mode: token === 'demo' ? 'demo' : 'configured_key',
    windows: WINDOWS,
    maxRequests: 42,
    maxCallUnits: 132,
    rawDataStored: false,
    catalogs: {},
    instruments: [],
  };
  let stopped = false;
  let requests = 0;
  async function request(path, params = {}) {
    if (stopped) return { status: 'skipped_after_limit' };
    if (requests > 0) await pause(token === 'demo' ? 100 : 3100);
    requests += 1;
    const url = new URL(path, 'https://eodhd.com');
    url.search = new URLSearchParams({
      api_token: token,
      fmt: 'json',
      ...params,
    }).toString();
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(20_000),
        redirect: 'error',
        headers: { Accept: 'application/json' },
      });
      const httpStatus = response.status;
      if (!response.ok) {
        await response.body?.cancel();
        const status =
          httpStatus === 401 || httpStatus === 403
            ? 'access_denied'
            : httpStatus === 402
              ? 'quota_exhausted'
              : httpStatus === 429
                ? 'rate_limited'
                : 'http_error';
        if (httpStatus === 402 || httpStatus === 429) stopped = true;
        return { status, httpStatus };
      }
      try {
        return {
          status: 'received',
          httpStatus,
          payload: await response.json(),
        };
      } catch {
        return { status: 'invalid_payload', httpStatus };
      }
    } catch {
      // Never serialize exceptions: their messages may contain the token or URL.
      return { status: 'network_error' };
    }
  }

  const catalogs = {};
  for (const exchange of ['WAR', 'US']) {
    const result = await request(`/api/exchange-symbol-list/${exchange}`);
    if (result.status === 'received') {
      const valid =
        Array.isArray(result.payload) &&
        result.payload.every(
          (row) => isObject(row) && typeof row.Code === 'string',
        );
      report.catalogs[exchange] = {
        status: valid ? 'available' : 'invalid_payload',
        httpStatus: result.httpStatus,
      };
      if (valid) catalogs[exchange] = result.payload;
    } else report.catalogs[exchange] = result;
  }

  for (const instrument of SAMPLE) {
    const symbol = `${instrument.code}.${instrument.exchange}`;
    const catalog = catalogs[instrument.exchange];
    const match = catalog?.find((row) => row.Code === instrument.code);
    const identity = !catalog
      ? { ...report.catalogs[instrument.exchange] }
      : !match
        ? { status: 'not_in_catalog' }
        : {
            status:
              match.Currency === instrument.currency &&
              match.Type === 'Common Stock'
                ? 'available'
                : 'invalid_payload',
            currencyMatches: match.Currency === instrument.currency,
            hasIsin: typeof match.Isin === 'string' && match.Isin.length > 0,
          };
    const row = { symbol, expectedCurrency: instrument.currency, identity };
    for (const kind of ['eod', 'splits', 'div', 'fundamentals']) {
      const path = kind === 'fundamentals' ? 'v1.1/fundamentals' : kind;
      const params =
        kind === 'fundamentals'
          ? { filter: 'General,Financials' }
          : kind === 'eod'
            ? { ...WINDOWS.eod, period: 'd', order: 'a' }
            : WINDOWS.actions;
      const result = await request(`/api/${path}/${symbol}`, params);
      if (kind === 'fundamentals' && !catalog && result.status === 'received') {
        const general = result.payload?.General;
        if (
          isObject(general) &&
          general.Code === instrument.code &&
          general.CurrencyCode === instrument.currency &&
          general.Type === 'Common Stock'
        ) {
          row.identity = {
            status: 'available',
            source: 'fundamentals',
            currencyMatches: true,
            hasIsin:
              typeof general.ISIN === 'string' && general.ISIN.length > 0,
          };
        }
      }
      row[kind] =
        result.status === 'received'
          ? {
              httpStatus: result.httpStatus,
              ...(kind === 'fundamentals'
                ? summarizeFundamentals(result.payload, instrument)
                : summarizeSeries(kind, result.payload)),
            }
          : result;
    }
    report.instruments.push(row);
  }
  report.requestsMade = requests;
  report.complete = report.instruments.every(
    (row) =>
      row.identity.status === 'available' &&
      row.eod.status === 'available' &&
      ['available', 'empty'].includes(row.splits.status) &&
      ['available', 'empty'].includes(row.div.status) &&
      row.fundamentals.status === 'available',
  );
  return report;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--demo')) {
    process.stderr.write('Użycie: node scripts/verify-eodhd.mjs [--demo]\n');
    process.exitCode = 1;
  } else {
    try {
      const report = await runProbe({
        token: args.includes('--demo') ? 'demo' : process.env.EODHD_API_TOKEN,
      });
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.exitCode = report.complete ? 0 : 2;
    } catch {
      process.stderr.write(
        'Ustaw EODHD_API_TOKEN w środowisku lub backend/.env albo podaj --demo.\n',
      );
      process.exitCode = 1;
    }
  }
}
