import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractReportMetrics, summarizeMetrics } from './report-summary.js';
import { readReportText } from './report-text.js';

function statement(lines: [number, number, string][]) {
  return lines.map(([x, y, str]) => ({
    str,
    transform: [1, 0, 0, 1, x, y],
    width: str.length * 4,
  }));
}

describe('Report card verification', () => {
  it('uses the latest year column, excluding currency signs and per-share or non-EBIT labels', () => {
    const items = statement([
      [40, 800, 'CONSOLIDATED STATEMENTS OF OPERATIONS'],
      [40, 785, 'In millions of USD, except per share amounts'],
      [400, 770, '2024'],
      [480, 770, '2025'],
      [40, 755, 'Total net sales'],
      [400, 755, '$'],
      [410, 755, '100,000'],
      [490, 755, '125,000'],
      [40, 740, 'Operating loss'],
      [410, 740, '(150)'],
      [490, 740, '(1,250)'],
      [40, 725, 'Other operating income'],
      [410, 725, '2'],
      [490, 725, '3'],
      [40, 710, 'Net income per share'],
      [410, 710, '1'],
      [490, 710, '2'],
    ]);
    expect(summarizeMetrics(extractReportMetrics(items, 12))).toEqual([
      {
        metric: 'revenue',
        state: 'verified',
        amount: '125000',
        unit: 'mln USD',
        period: '2025',
        page: 12,
        scope: 'consolidated',
      },
      {
        metric: 'ebit',
        state: 'verified',
        amount: '-1250',
        unit: 'mln USD',
        period: '2025',
        page: 12,
        scope: 'consolidated',
      },
      { metric: 'netIncome', state: 'missing' },
      { metric: 'operatingCashFlow', state: 'missing' },
      { metric: 'longTermDebt', state: 'missing' },
    ]);
  });

  it('requires verification for missing units, unmatched periods and competing amounts', () => {
    const rows: [number, number, string][] = [
      [40, 790, 'SKONSOLIDOWANY RACHUNEK ZYSKÓW I STRAT'],
      [400, 760, '2025'],
      [480, 760, '2024'],
      [40, 745, 'Przychody ze sprzedaży'],
      [405, 745, '45 000'],
      [490, 745, '42 000'],
      [40, 730, 'Przychody ze sprzedaży'],
      [405, 730, '450'],
      [490, 730, '420'],
      [40, 715, 'Zysk netto'],
      [405, 715, '1 251,50'],
      [490, 715, '980'],
    ];
    const verified = extractReportMetrics(
      statement([...rows, [40, 775, 'w tys. PLN']]),
      8,
    );
    expect(summarizeMetrics(verified)).toEqual([
      { metric: 'revenue', state: 'needs_review' },
      { metric: 'ebit', state: 'missing' },
      {
        metric: 'netIncome',
        state: 'verified',
        amount: '1251.5',
        unit: 'tys. PLN',
        period: '2025',
        page: 8,
        scope: 'consolidated',
      },
      { metric: 'operatingCashFlow', state: 'missing' },
      { metric: 'longTermDebt', state: 'missing' },
    ]);
    expect(
      summarizeMetrics(extractReportMetrics(statement(rows), 8))[2],
    ).toEqual({ metric: 'netIncome', state: 'needs_review' });
    expect(
      summarizeMetrics(
        extractReportMetrics(
          statement([...rows, [40, 775, 'Kwartał, w tys. PLN']]),
          8,
        ),
      )[2],
    ).toEqual({ metric: 'netIncome', state: 'needs_review' });
  });

  it('does not show a value when the comparison column cannot be aligned', () => {
    const items = statement([
      [40, 800, 'CONSOLIDATED STATEMENTS OF OPERATIONS'],
      [40, 785, 'In millions of USD'],
      [400, 770, '2024'],
      [480, 770, '2025'],
      [40, 755, 'Total net sales'],
      [490, 755, '125,000'],
    ]);
    expect(summarizeMetrics(extractReportMetrics(items, 12))[0]).toEqual({
      metric: 'revenue',
      state: 'needs_review',
    });
  });

  it('does not substitute a standalone value into a consolidated report card', () => {
    const flow = extractReportMetrics(
      statement([
        [40, 800, 'Standalone Statement of Cash Flows'],
        [40, 780, 'In millions of USD'],
        [400, 760, '2025'],
        [480, 760, '2024'],
        [40, 740, 'Cash used in operating activities'],
        [410, 740, '(50)'],
        [490, 740, '10'],
      ]),
      9,
    );
    const debt = extractReportMetrics(
      statement([
        [40, 800, 'Consolidated Balance Sheet'],
        [40, 780, 'In millions of USD'],
        [400, 760, '2025'],
        [480, 760, '2024'],
        [40, 740, 'Current liabilities'],
        [40, 720, 'Term debt'],
        [410, 720, '3'],
        [490, 720, '2'],
        [40, 700, 'Non-current liabilities'],
        [40, 680, 'Term debt'],
        [410, 680, '70'],
        [490, 680, '50'],
      ]),
      10,
    );
    expect(summarizeMetrics(flow)[3]).toMatchObject({
      metric: 'operatingCashFlow',
      state: 'verified',
      amount: '-50',
      page: 9,
      scope: 'standalone',
    });
    expect(summarizeMetrics([...flow, ...debt]).slice(3)).toEqual([
      { metric: 'operatingCashFlow', state: 'missing' },
      {
        metric: 'longTermDebt',
        state: 'verified',
        amount: '70',
        page: 10,
        period: '2025',
        unit: 'mln USD',
        scope: 'consolidated',
      },
    ]);
  });
});

// The issuer PDFs are optional local fixtures. See docs/fundamental-analysis-fixtures.md.
const fixtureDir = process.env.FUNDAMENTAL_REPORT_FIXTURES_DIR;
type Source = [amount: string, page: number, period?: string];
type Expected = Source | 'missing' | 'needs_review';
type ReportFixture = {
  file: string;
  unit: string;
  period: string;
  scope?: 'standalone';
  sourcePage: number;
  facts: [Expected, Expected, Expected, Expected, Expected];
};
const fixtures: ReportFixture[] = [
  {
    file: 'apple.pdf',
    unit: 'mln $',
    period: '2026',
    sourcePage: 35,
    facts: [
      ['478834', 35],
      ['158063', 35],
      ['132175', 35],
      ['145097', 39],
      ['68208', 37, 'September 26, 2026'],
    ],
  },
  {
    file: 'amazon.pdf',
    unit: 'mln $',
    period: '2025',
    sourcePage: 48,
    facts: [
      ['716924', 48],
      ['79975', 48],
      ['77670', 48],
      ['139514', 47],
      ['65648', 50, 'December 31, 2025'],
    ],
  },
  {
    file: 'amd.pdf',
    unit: 'mln $',
    period: '2025',
    sourcePage: 61,
    facts: [
      ['34639', 61],
      ['3694', 61],
      ['4335', 61],
      ['7709', 65],
      ['2348', 63, 'December 27, 2025'],
    ],
  },
  {
    file: 'target.pdf',
    unit: 'mln $',
    period: '2025',
    sourcePage: 51,
    facts: [
      ['104780', 51],
      ['5117', 51],
      ['3705', 51],
      ['6562', 54],
      ['14326', 53, 'January 31, 2026'],
    ],
  },
  {
    file: 'target-2024.pdf',
    unit: 'mln $',
    period: '2024',
    sourcePage: 49,
    facts: [
      ['106566', 49],
      ['5566', 49],
      ['4091', 49],
      ['7367', 52],
      ['14304', 51, 'February 1, 2025'],
    ],
  },
  {
    file: 'kety.pdf',
    unit: 'mln PLN',
    period: '2025',
    sourcePage: 5,
    facts: [['5494', 5], ['784', 5], ['569', 5], ['937', 11], 'missing'],
  },
  {
    file: 'kghm.pdf',
    unit: 'mln PLN',
    period: '01.01.2025 – 31.12.2025',
    sourcePage: 5,
    facts: [['36366', 5], 'missing', ['3688', 5], ['4035', 7], 'missing'],
  },
  {
    file: 'cdprojekt-group.pdf',
    unit: 'tys. PLN',
    period: '01.01.2025 – 31.12.2025',
    sourcePage: 5,
    facts: [
      ['866989', 5],
      ['470648', 5],
      ['594708', 5],
      ['590880', 10],
      'missing',
    ],
  },
  {
    file: 'cdprojekt-company.pdf',
    unit: 'tys. PLN',
    period: '01.01.2025 – 31.12.2025',
    scope: 'standalone',
    sourcePage: 5,
    facts: [
      ['866989', 5],
      ['477988', 5],
      ['635209', 5],
      ['567948', 9],
      'missing',
    ],
  },
  {
    file: 'pko.pdf',
    unit: 'mln PLN',
    period: '2025',
    sourcePage: 6,
    facts: ['missing', 'missing', ['10682', 6], ['11852', 11], 'missing'],
  },
];
describe.skipIf(!fixtureDir)('Report card for public issuer PDFs', () => {
  it.each(fixtures)(
    'matches the figures and the physical PDF page in $file',
    async ({
      file,
      sourcePage,
      unit,
      period,
      scope = 'consolidated',
      facts,
    }) => {
      const bytes = await readFile(join(fixtureDir!, file));
      const report = await readReportText(
        bytes,
        'Podsumuj wyniki spółki i sprawdź stronę ' + sourcePage + '.',
        AbortSignal.timeout(15000),
      );
      const pageNumbers = Array.from(
        report.text.matchAll(/^\[str\. (\d+)\]$/gm),
        (match) => Number(match[1]),
      );
      expect(report.coverage.partial).toBe(true);
      expect(report.coverage.contextPages.map((item) => item.number)).toEqual(
        pageNumbers,
      );
      expect(pageNumbers).toContain(sourcePage);
      const metrics = [
        'revenue',
        'ebit',
        'netIncome',
        'operatingCashFlow',
        'longTermDebt',
      ];
      expect(report.summary).toEqual(
        facts.map((fact, index) =>
          typeof fact === 'string'
            ? { metric: metrics[index], state: fact }
            : {
                metric: metrics[index],
                state: 'verified',
                amount: fact[0],
                unit,
                period: fact[2] ?? period,
                page: fact[1],
                scope,
              },
        ),
      );
    },
    20000,
  );
});
