import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runFreeProbe } from './verify-eodhd-free.mjs';
import { SAMPLE } from './verify-eodhd.mjs';

test('free probe verifies ten identities and prices with at most twelve units and no paid endpoints', async () => {
  const paths = [];
  const report = await runFreeProbe({ token: 'SYNTHETIC_SECRET', pause: async () => {}, fetchImpl: async (url, options) => {
    assert.equal(options.redirect, 'error'); paths.push(url.pathname);
    if (url.pathname === '/api/user') return Response.json({ apiRequests: 0, dailyRateLimit: 20, email: 'private@example.invalid' });
    if (url.pathname.includes('exchange-symbol-list')) return Response.json(SAMPLE.filter(row => url.pathname.endsWith(row.exchange)).map(row => ({ Code: row.code, Currency: row.currency, Type: 'Common Stock' })));
    return Response.json([{ date: '2026-11-17', open: '1', high: '2', low: '1', close: '2', adjusted_close: '2', volume: 10 }]);
  } });
  assert.equal(report.pricesAndIdentityComplete, true);
  assert.equal(report.fullProviderVerificationComplete, false);
  assert.equal(report.callUnitsReserved, 12);
  assert.ok(!paths.some(path => path.includes('fundamentals')));
  assert.ok(!JSON.stringify(report).includes('SYNTHETIC_SECRET'));
  assert.ok(!JSON.stringify(report).includes('private@example.invalid'));
});

test('daily budget wins over a large welcome bonus and stops at the remaining allowance', async () => {
  let count = 0;
  const report = await runFreeProbe({ token: 'synthetic', pause: async () => {}, fetchImpl: async url => {
    if (url.pathname === '/api/user') return Response.json({ apiRequests: 19, dailyRateLimit: 20, extraLimit: 500 });
    count += 1; return Response.json([]);
  } });
  assert.equal(count, 1);
  assert.equal(report.allowedCallUnits, 1);
  assert.equal(report.pricesAndIdentityComplete, false);
});

test('quota response stops without retry, and exceptions never expose URLs or credentials', async () => {
  for (const fail of [async () => new Response('secret', { status: 402 }), async url => { throw new Error(String(url)); }]) {
    let count = 0;
    const report = await runFreeProbe({ token: 'PRIVATE_SECRET', pause: async () => {}, fetchImpl: async url => {
      if (url.pathname === '/api/user') return Response.json({ apiRequests: 0, dailyRateLimit: 20 });
      count += 1; return fail(url);
    } });
    assert.equal(count, 1);
    assert.ok(!JSON.stringify(report).includes('PRIVATE_SECRET'));
  }
});

test('actions mode probes splits and dividends for both markets within the daily allowance', async () => {
  const paths = [];
  const report = await runFreeProbe({
    token: 'SYNTHETIC_SECRET',
    actions: true,
    now: new Date('2026-11-23T12:00:00Z'),
    pause: async () => {},
    fetchImpl: async (url) => {
      if (url.pathname === '/api/user') {
        return Response.json({ apiRequests: 0, dailyRateLimit: 20 });
      }
      paths.push(url.pathname);
      assert.equal(url.searchParams.get('from'), '2025-11-23');
      assert.equal(url.searchParams.get('to'), '2026-11-22');
      if (url.pathname.startsWith('/api/splits/')) return Response.json([]);
      return Response.json([{ date: '2026-06-01', value: 5, currency: 'PLN' }]);
    },
  });
  assert.deepEqual(paths, SAMPLE.flatMap(({ code, exchange }) =>
    ['splits', 'div'].map((kind) => `/api/${kind}/${code}.${exchange}`),
  ));
  assert.equal(report.callUnitsReserved, 20);
  assert.equal(report.actionsComplete, true);
  assert.equal(report.fullProviderVerificationComplete, false);
  assert.equal(report.instruments[0].div.hasPaymentDate, false);
  assert.ok(!JSON.stringify(report).includes('SYNTHETIC_SECRET'));
});
