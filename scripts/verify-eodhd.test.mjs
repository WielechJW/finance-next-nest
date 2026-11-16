import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  runProbe,
  SAMPLE,
  summarizeFundamentals,
  summarizeSeries,
} from './verify-eodhd.mjs';

// These are invented contract examples, not downloaded vendor data.
const bar = {
  date: '2026-11-02',
  open: '10.01',
  high: '11.00',
  low: '9.50',
  close: '10.50',
  adjusted_close: '10.40',
  volume: 100,
};
const reportRow = { date: '2025-12-31', totalAssets: '100.00' };
const fundamentals = (instrument) => ({
  General: {
    Code: instrument.code,
    CurrencyCode: instrument.currency,
    Type: 'Common Stock',
  },
  Financials: Object.fromEntries(
    ['Balance_Sheet', 'Income_Statement', 'Cash_Flow'].map((name) => [
      name,
      { yearly: { example: reportRow }, quarterly: {} },
    ]),
  ),
});
const noPause = async () => {};

test('an empty series is different from an unavailable or malformed response', () => {
  assert.deepEqual(summarizeSeries('splits', []), { status: 'empty', rows: 0 });
  assert.equal(
    summarizeSeries('eod', { error: 'not entitled' }).status,
    'invalid_payload',
  );
  assert.equal(summarizeSeries('eod', [bar]).status, 'available');
  assert.equal(
    summarizeSeries('eod', [{ ...bar, close: null }]).status,
    'invalid_payload',
  );
  assert.equal(
    summarizeSeries('eod', [{ ...bar, date: '2026-02-30' }]).status,
    'invalid_payload',
  );
});

test('corporate actions preserve missing fields instead of inventing amounts or payment dates', () => {
  assert.deepEqual(
    summarizeSeries('div', [
      { date: bar.date, value: '0.10', currency: 'USD' },
    ]),
    {
      status: 'available',
      rows: 1,
      hasUnadjustedValue: false,
      hasPaymentDate: false,
    },
  );
  assert.equal(
    summarizeSeries('splits', [{ date: bar.date, split: '4/1' }]).status,
    'available',
  );
  assert.equal(
    summarizeSeries('splits', [{ date: bar.date, split: '4/0' }]).status,
    'invalid_payload',
  );
});

test('fundamentals require matching identity, currency and populated statements', () => {
  const instrument = SAMPLE[0];
  const payload = fundamentals(instrument);
  assert.equal(summarizeFundamentals(payload, instrument).status, 'available');
  assert.equal(
    summarizeFundamentals(payload, { ...instrument, currency: 'USD' }).status,
    'invalid_payload',
  );
  assert.equal(
    summarizeFundamentals(payload, { ...instrument, code: 'OTHER' }).status,
    'invalid_payload',
  );
  payload.Financials.Cash_Flow.yearly = {
    example: { date: '2025-12-31', totalAssets: null },
  };
  assert.equal(summarizeFundamentals(payload, instrument).status, 'incomplete');
});

test('a successful ten-instrument probe stores only fixed metadata and no raw prices or credentials', async () => {
  const token = 'SYNTHETIC_PRIVATE_TOKEN';
  const paths = [];
  const fetchImpl = async (url, options) => {
    assert.equal(url.origin, 'https://eodhd.com');
    assert.equal(url.searchParams.get('api_token'), token);
    assert.equal(options.redirect, 'error');
    paths.push(url.pathname);
    const symbol = url.pathname.split('/').at(-1);
    if (url.pathname.includes('exchange-symbol-list')) {
      return Response.json(
        SAMPLE.filter((row) => row.exchange === symbol).map((row) => ({
          Code: row.code,
          Currency: row.currency,
          Type: 'Common Stock',
          Name: token,
          Isin: 'SYNTHETIC_IDENTIFIER',
        })),
      );
    }
    const instrument = SAMPLE.find(
      (row) => `${row.code}.${row.exchange}` === symbol,
    );
    if (url.pathname.includes('fundamentals'))
      return Response.json(fundamentals(instrument));
    return Response.json(url.pathname.includes('/eod/') ? [bar] : []);
  };
  const report = await runProbe({ token, fetchImpl, pause: noPause });
  assert.equal(report.complete, true);
  assert.equal(report.requestsMade, 42);
  assert.equal(report.instruments.length, 10);
  assert.equal(
    report.instruments.filter((row) => row.expectedCurrency === 'PLN').length,
    5,
  );
  assert.ok(paths.includes('/api/v1.1/fundamentals/CDR.WAR'));
  const output = JSON.stringify(report);
  assert.ok(!output.includes(token));
  assert.ok(!output.includes('SYNTHETIC_IDENTIFIER'));
  assert.ok(!output.includes('10.50'));
});

test('a restricted demo token cannot produce a successful GPW verification', async () => {
  const report = await runProbe({
    token: 'demo',
    pause: noPause,
    fetchImpl: async () =>
      new Response('Access denied: do not persist this body', { status: 403 }),
  });
  assert.equal(report.complete, false);
  assert.equal(report.instruments[0].eod.status, 'access_denied');
  assert.ok(!JSON.stringify(report).includes('do not persist'));
});

test('identity can be checked in fundamentals when the symbol catalog is unavailable', async () => {
  const report = await runProbe({
    token: 'demo',
    pause: noPause,
    fetchImpl: async (url) => {
      if (url.pathname.includes('fundamentals')) {
        const instrument = SAMPLE.find((row) =>
          url.pathname.endsWith(`${row.code}.${row.exchange}`),
        );
        return Response.json(fundamentals(instrument));
      }
      return new Response('', { status: 403 });
    },
  });
  assert.equal(report.catalogs.WAR.status, 'access_denied');
  assert.equal(report.instruments[0].identity.source, 'fundamentals');
  assert.equal(report.instruments[0].identity.status, 'available');
  assert.equal(report.complete, false);
});

for (const [httpStatus, status] of [
  [402, 'quota_exhausted'],
  [429, 'rate_limited'],
]) {
  test(`HTTP ${httpStatus} stops further calls without retries or additional quota use`, async () => {
    let calls = 0;
    const report = await runProbe({
      token: 'demo',
      pause: noPause,
      fetchImpl: async () => {
        calls += 1;
        return new Response('', { status: httpStatus });
      },
    });
    assert.equal(calls, 1);
    assert.equal(report.catalogs.WAR.status, status);
    assert.equal(report.instruments[0].eod.status, 'skipped_after_limit');
    assert.equal(report.complete, false);
  });
}

test('a missing key performs no network requests', async () => {
  let calls = 0;
  await assert.rejects(
    runProbe({
      fetchImpl: async () => {
        calls += 1;
      },
    }),
    /EODHD_API_TOKEN/,
  );
  assert.equal(calls, 0);
});

test('network exceptions and HTML responses never expose a token or become successful data', async () => {
  const token = 'SYNTHETIC_PRIVATE_TOKEN';
  const report = await runProbe({
    token,
    pause: noPause,
    fetchImpl: async (url) => {
      if (url.pathname.includes('/eod/'))
        return new Response(`<html>${token}</html>`);
      throw new Error(`https://eodhd.com?api_token=${token}`);
    },
  });
  assert.equal(report.instruments[0].eod.status, 'invalid_payload');
  assert.equal(report.instruments[0].div.status, 'network_error');
  assert.ok(!JSON.stringify(report).includes(token));
});
