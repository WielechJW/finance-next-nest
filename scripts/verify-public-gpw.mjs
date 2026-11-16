// One-off availability probe. Never write provider price, dividend or report values.
const ENDPOINT = 'https://agentrynku.pl/api/mcp';

export const SAMPLE = [
  { eodhdSymbol: 'CDR.WAR', query: 'CD PROJEKT' },
  { eodhdSymbol: 'PKN.WAR', query: 'PKN' },
  { eodhdSymbol: 'PKO.WAR', query: 'PKO' },
  { eodhdSymbol: 'PZU.WAR', query: 'PZU' },
  { eodhdSymbol: 'KGH.WAR', query: 'KGH' },
];

export function unwrapRpc(httpStatus, payload) {
  if (httpStatus !== 200) return { status: 'http_error', httpStatus };
  if (payload?.error || payload?.result?.isError)
    return { status: 'provider_error', httpStatus };
  const content = payload?.result?.content;
  if (!Array.isArray(content) || content.length !== 1 || content[0]?.type !== 'text')
    return { status: 'invalid_payload', httpStatus };
  try {
    const data = JSON.parse(content[0].text);
    if (!data || typeof data !== 'object' || Array.isArray(data))
      return { status: 'invalid_payload', httpStatus };
    return { status: 'received', data };
  } catch {
    return { status: 'invalid_payload', httpStatus };
  }
}

export function summarize(kind, result) {
  if (result.status !== 'received') return result;
  const data = result.data;
  if (kind === 'identity') {
    if (!Array.isArray(data.companies) || !Number.isInteger(data.returned))
      return { status: 'invalid_payload' };
    if (data.companies.length !== 1 || data.returned !== 1)
      return { status: 'ambiguous_or_missing', matches: data.returned };
    const company = data.companies[0];
    if (typeof company.symbol !== 'string' || !company.symbol)
      return { status: 'invalid_payload' };
    return {
      status: 'available',
      canonicalSymbol: company.symbol,
      hasIsin: typeof company.isin === 'string' && company.isin.length > 0,
    };
  }
  if (kind === 'prices') {
    if (!Array.isArray(data.candles) || !Number.isInteger(data.candleCount))
      return { status: 'invalid_payload' };
    if (data.candleCount !== data.candles.length)
      return { status: 'invalid_payload' };
    return {
      status: data.candleCount ? 'available' : 'empty',
      rows: data.candleCount,
      currency: typeof data.currency === 'string' ? data.currency : null,
      hasSource: typeof data.source === 'string' && data.source.length > 0,
      hasUpdateTime: typeof data.seriesUpdatedAt === 'string',
      lastSession: typeof data.lastCandleAt === 'string'
        ? data.lastCandleAt.slice(0, 10)
        : null,
      scales: [...new Set(data.candles.map((row) => row?.priceScale ?? 'unknown'))],
      truncated: data.truncated === true,
    };
  }
  if (kind === 'dividends') {
    if (
      !Array.isArray(data.events) ||
      !Number.isInteger(data.returned) ||
      data.events.length !== data.returned
    )
      return { status: 'invalid_payload' };
    return {
      status: data.returned ? 'available' : 'empty',
      rows: data.returned,
      hasSourceLinks: data.events.length
        ? data.events.every((row) => typeof row?.sourceUrl === 'string')
        : null,
      truncated: data.truncated === true,
    };
  }
  if (!Array.isArray(data.quarters)) return { status: 'invalid_payload' };
  return {
    status: data.quarters.length ? 'available' : 'empty',
    rows: data.quarters.length,
    hasSourceLinks: data.quarters.length
      ? data.quarters.every((row) => typeof row?.sourceUrl === 'string')
      : null,
    // Reporting currency is not the exchange quote currency.
    reportingCurrencies: [
      ...new Set(data.quarters.map((row) => row?.currency).filter((v) => typeof v === 'string')),
    ],
  };
}

export async function runProbe({ fetchImpl = fetch } = {}) {
  const report = {
    provider: 'Agent Rynku public MCP',
    checkedAt: new Date().toISOString(),
    purpose: 'availability_only',
    rawDataStored: false,
    maxRequests: 20,
    instruments: [],
  };
  let requestsMade = 0;
  let halted = false;
  async function call(name, args) {
    if (halted) return { status: 'skipped_after_limit' };
    requestsMade += 1;
    try {
      const response = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: requestsMade,
          method: 'tools/call',
          params: { name, arguments: args },
        }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429) halted = true;
        return { status: 'http_error', httpStatus: response.status };
      }
      const result = unwrapRpc(response.status, await response.json());
      if (result.status === 'provider_error') halted = true;
      return result;
    } catch {
      // An exception may contain a request URL. Do not serialize it.
      return { status: 'network_or_format_error' };
    }
  }
  for (const { eodhdSymbol, query } of SAMPLE) {
    const identity = summarize(
      'identity',
      await call('search_gpw_companies', { query, limit: 2 }),
    );
    const symbol = identity.canonicalSymbol;
    const row = { eodhdSymbol, searchQuery: query, identity };
    if (symbol) {
      row.prices = summarize(
        'prices',
        await call('get_public_price_history', { symbol, days: 30, limit: 10 }),
      );
      row.dividends = summarize(
        'dividends',
        await call('get_public_dividends', { symbol, limit: 3 }),
      );
      row.fundamentals = summarize(
        'fundamentals',
        await call('get_quarterly_kpis', { symbol, quartersBack: 2 }),
      );
    } else {
      row.prices = row.dividends = row.fundamentals = {
        status: 'skipped_without_identity',
      };
    }
    row.splits = { status: 'no_public_endpoint' };
    report.instruments.push(row);
  }
  report.requestsMade = requestsMade;
  report.allRequiredFieldsPresent = report.instruments.every(
    (row) =>
      row.identity.status === 'available' &&
      row.prices.status === 'available' &&
      ['available', 'empty'].includes(row.dividends.status) &&
      row.fundamentals.status === 'available' &&
      ['available', 'empty'].includes(row.splits.status),
  );
  return report;
}

if (import.meta.main) {
  const report = await runProbe();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.instruments.every(
    (row) =>
      row.identity.status === 'available' &&
      row.prices.status === 'available' &&
      ['available', 'empty'].includes(row.dividends.status) &&
      row.fundamentals.status === 'available',
  )
    ? 0
    : 2;
}
