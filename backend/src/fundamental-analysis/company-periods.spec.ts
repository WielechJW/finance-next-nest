import { describe, expect, it } from 'vitest';
import { trailingYear } from './company-periods.js';

function quarters() {
  return [
    ['2025-10-01', '2025-12-31', '01.10.2025 – 31.12.2025'],
    ['2025-07-01', '2025-09-30', '01.07.2025 – 30.09.2025'],
    ['2025-04-01', '2025-06-30', '01.04.2025 – 30.06.2025'],
    ['2025-01-01', '2025-03-31', '01.01.2025 – 31.03.2025'],
  ].map(([periodStart, periodEnd, period], index) => ({
    id: String(index),
    periodStart: periodStart!,
    periodEnd: periodEnd!,
    currency: 'PLN',
    facts: [
      {
        metric: 'REVENUE' as const,
        amount: '10.25',
        unit: 'mln PLN',
        period: period!,
        page: 4,
      },
      {
        metric: 'LONG_TERM_DEBT' as const,
        amount: '20',
        unit: 'mln PLN',
        period: '31.12.2025',
        page: 6,
      },
    ],
  }));
}

describe('Trailing year of issuer reports', () => {
  it('sums comparable flows and keeps debt from the most recent balance sheet', () => {
    expect(trailingYear(quarters())).toEqual({
      periodStart: '2025-01-01',
      periodEnd: '2025-12-31',
      currency: 'PLN',
      facts: [
        {
          metric: 'REVENUE',
          amount: '41',
          unit: 'mln PLN',
          sources: ['3', '2', '1', '0'].map((reportId) => ({
            reportId,
            page: 4,
          })),
        },
        {
          metric: 'LONG_TERM_DEBT',
          amount: '20',
          unit: 'mln PLN',
          sources: [{ reportId: '0', page: 6 }],
        },
      ],
    });
  });

  it('leaves missing quarters, conflicting units and mismatched report periods out of TTM', () => {
    const reports = quarters();
    expect(trailingYear(reports.slice(1))).toBeNull();
    reports[2]!.periodEnd = '2025-06-29';
    expect(trailingYear(reports)).toBeNull();
    reports[2]!.periodEnd = '2025-06-30';
    reports[1]!.facts[0]!.unit = 'tys. PLN';
    expect(trailingYear(reports)?.facts.map(({ metric }) => metric)).toEqual([
      'LONG_TERM_DEBT',
    ]);
    reports[1]!.facts[0]!.unit = 'mln PLN';
    reports[2]!.facts[0]!.period = '2025';
    expect(trailingYear(reports)?.facts.map(({ metric }) => metric)).toEqual([
      'LONG_TERM_DEBT',
    ]);
  });
});
