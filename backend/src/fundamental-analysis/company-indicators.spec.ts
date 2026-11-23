import { describe, expect, it } from 'vitest';
import { calculateCompanyIndicators } from './company-indicators.js';

type Report = Parameters<typeof calculateCompanyIndicators>[0];

function reports(): [Report, Report] {
  return [
    {
      id: 'current',
      periodStart: '2025-01-01',
      periodEnd: '2025-12-31',
      publishedOn: '2026-02-10',
      periodKind: 'ANNUAL',
      currency: 'USD',
      facts: [
        { metric: 'REVENUE', amount: '120', unit: 'mln USD', page: 5 },
        { metric: 'EBIT', amount: '15', unit: 'mln USD', page: 5 },
        { metric: 'NET_INCOME', amount: '9', unit: 'mln USD', page: 5 },
        { metric: 'TOTAL_EQUITY', amount: '110', unit: 'mln USD', page: 7 },
        { metric: 'DILUTED_EPS', amount: '2.5', unit: 'USD / akcję', page: 5 },
        {
          metric: 'BOOK_VALUE_PER_SHARE',
          amount: '5',
          unit: 'USD / akcję',
          page: 7,
        },
      ],
    },
    {
      id: 'previous',
      periodStart: '2024-01-01',
      periodEnd: '2024-12-31',
      publishedOn: '2025-02-10',
      periodKind: 'ANNUAL',
      currency: 'USD',
      facts: [
        { metric: 'REVENUE', amount: '100000', unit: 'tys. USD', page: 4 },
        { metric: 'TOTAL_EQUITY', amount: '90', unit: 'mln USD', page: 9 },
      ],
    },
  ];
}

const quote = {
  status: 'fresh',
  price: { close: '25', currency: 'USD', sessionOn: '2026-11-20' },
};

describe('Company ratios from verified facts', () => {
  it('uses Decimal calculations, scale conversion and the corrected report as the input', () => {
    const [current, previous] = reports();
    const values = calculateCompanyIndicators(
      current,
      [current, previous],
      quote,
      [],
    );
    expect(values.priceEarnings.value).toBe('10.00');
    expect(values.priceBook.value).toBe('5.00');
    expect(values.roe.value).toBe('9.00');
    expect(values.operatingMargin).toMatchObject({
      value: '12.50',
      sources: [{ reportId: 'current', page: 5 }],
    });
    expect(values.netMargin.value).toBe('7.50');
    expect(values.revenueGrowth.value).toBe('20.00');
    current.facts.find((fact) => fact.metric === 'REVENUE')!.amount = '125';
    expect(
      calculateCompanyIndicators(current, [current, previous], quote, [])
        .revenueGrowth.value,
    ).toBe('25.00');
  });

  it('explains a stale quote, mismatched currency, missing quarter and nonpositive denominator', () => {
    const [current, previous] = reports();
    expect(
      calculateCompanyIndicators(
        current,
        [previous],
        { ...quote, status: 'stale' },
        [],
      ).priceEarnings,
    ).toMatchObject({
      value: null,
      reason: 'Brak aktualnego kursu zamknięcia.',
    });
    expect(
      calculateCompanyIndicators(
        current,
        [previous],
        { ...quote, price: { ...quote.price, currency: 'PLN' } },
        [],
      ).priceBook,
    ).toMatchObject({
      value: null,
      reason: 'Kurs i raport mają różne waluty.',
    });
    expect(
      calculateCompanyIndicators(current, [previous], quote, ['2026-05-01'])
        .priceBook.value,
    ).toBeNull();
    current.facts.find((fact) => fact.metric === 'DILUTED_EPS')!.amount = '-2';
    current.facts.find((fact) => fact.metric === 'NET_INCOME')!.amount = '-9';
    const negative = calculateCompanyIndicators(current, [previous], quote, []);
    expect(negative.priceEarnings.value).toBeNull();
    expect(negative.roe.value).toBe('-9.00');
    const quarter = {
      ...current,
      periodKind: 'QUARTERLY' as const,
      periodStart: '2025-10-01',
    };
    expect(
      calculateCompanyIndicators(quarter, [previous], quote, []).revenueGrowth
        .value,
    ).toBeNull();
    previous.periodStart = '2024-01-07';
    expect(
      calculateCompanyIndicators(current, [previous], quote, []).revenueGrowth
        .value,
    ).toBeNull();
  });
});
