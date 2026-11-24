import { describe, expect, it } from 'vitest';
import {
  listedAt,
  reportsKnownAt,
  validateHistoricalContext,
} from './historical-context.js';
import type {
  StrategyFundamentalReport,
  StrategyRule,
  StrategyUniverseMember,
} from '../strategies/strategy.js';
import { replayMarket } from './market-replay.js';

const universe: StrategyUniverseMember[] = [
  {
    mic: 'XNAS',
    ticker: 'RETIRED',
    currency: 'USD',
    listedOn: '2020-01-01',
    delistedOn: '2026-07-10',
  },
  { mic: 'XNAS', ticker: 'NOW', currency: 'USD', listedOn: '2020-01-01' },
  { mic: 'XNAS', ticker: 'IPO', currency: 'USD', listedOn: '2026-07-13' },
];
const report: StrategyFundamentalReport = {
  id: 'report-1',
  ticker: 'NOW',
  mic: 'XNAS',
  periodEnd: '2026-03-31',
  scope: 'CONSOLIDATED',
  revision: 1,
  publishedAt: '2026-07-08T22:00:00Z',
  availableAt: '2026-07-08T22:30:00Z',
  facts: [{ metric: 'EBIT', amount: '10', unit: 'mln USD' }],
  sourceUrl: 'https://example.com/report.pdf',
};
const day = '2026-07-09';
const now = new Date(day + 'T22:00:00Z');

describe('point-in-time backtest input', () => {
  it('keeps delisted companies in eligible earlier sessions and avoids adding a later IPO', () => {
    expect(listedAt(universe, day).map((item) => item.ticker)).toEqual([
      'NOW',
      'RETIRED',
    ]);
    expect(listedAt(universe, '2026-07-10').map((item) => item.ticker)).toEqual(
      ['NOW'],
    );
    expect(listedAt(universe, '2026-07-13').map((item) => item.ticker)).toEqual(
      ['IPO', 'NOW'],
    );
  });

  it('uses only published and observed versions and aborts a rule requiring a future report', () => {
    const future = {
      ...report,
      id: 'report-2',
      revision: 2,
      publishedAt: '2026-07-10T18:00:00Z',
      availableAt: '2026-07-10T19:00:00Z',
    };
    const delayed = {
      ...report,
      id: 'report-3',
      revision: 3,
      availableAt: '2026-07-13T22:00:00Z',
    };
    const source = 'Issuer reports';
    validateHistoricalContext({
      source,
      universe,
      reports: [report, future, delayed],
    });
    expect(
      reportsKnownAt([report, delayed, future], listedAt(universe, day), now),
    ).toEqual([report]);
    const rule: StrategyRule<object> = {
      key: 'test',
      codeVersion: '1',
      requiredFundamentals: ['EBIT'],
      parseParameters: () => ({}),
      evaluate: (data) => {
        expect(data.reports).toEqual([report]);
        return {
          kind: 'NO_SIGNAL',
          reason: 'NO_CROSSOVER',
          decidedAt: data.decidedAt.toISOString(),
          instrumentId: 'NOW',
          evidence: { expectedSessionOn: day, barIds: [], splitIds: [] },
        };
      },
    };
    const options = {
      instrument: { id: 'NOW', mic: 'XNAS', currency: 'USD' as const },
      startingCash: '100',
      orderQuantity: '1',
      maxWaitSessions: 1,
      sessions: [{ sessionOn: day, decidedAt: now, opening: null }],
      rule,
      parameters: {},
      bars: [],
      splits: [],
    };
    expect(() =>
      replayMarket({
        ...options,
        history: {
          source,
          selectedKey: 'XNAS:NOW',
          universe,
          reports: [future],
        },
      }),
    ).toThrow('Brak wymaganych opublikowanych fundamentów');
    expect(
      replayMarket({
        ...options,
        history: {
          source,
          selectedKey: 'XNAS:NOW',
          universe,
          reports: [report, future],
        },
      }).decisions,
    ).toHaveLength(1);
  });
});
