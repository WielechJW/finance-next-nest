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
      },
      {
        metric: 'ebit',
        state: 'verified',
        amount: '-1250',
        unit: 'mln USD',
        period: '2025',
        page: 12,
      },
      { metric: 'netIncome', state: 'missing' },
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
      },
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
});

// The issuer PDFs are optional local fixtures. See docs/fundamental-analysis-fixtures.md.
const fixtureDir = process.env.FUNDAMENTAL_REPORT_FIXTURES_DIR;
describe.skipIf(!fixtureDir)('Report card for public issuer PDFs', () => {
  it.each([
    {
      file: 'apple.pdf',
      page: 35,
      unit: 'mln $',
      period: '2026',
      amounts: ['478834', '158063', '132175'],
    },
    {
      file: 'amazon.pdf',
      page: 48,
      unit: 'mln $',
      period: '2025',
      amounts: ['716924', '79975', '77670'],
    },
    {
      file: 'kety.pdf',
      page: 5,
      unit: 'mln PLN',
      period: '2025',
      amounts: ['5494', '784', '569'],
    },
    {
      file: 'kghm.pdf',
      page: 5,
      unit: 'mln PLN',
      period: '01.01.2025 – 31.12.2025',
      amounts: ['36366', null, '3688'],
    },
  ])(
    'matches the figures and the physical PDF page in $file',
    async ({ file, page, unit, period, amounts }) => {
      const bytes = await readFile(join(fixtureDir!, file));
      const report = await readReportText(
        bytes,
        'Podsumuj wyniki spółki i sprawdź stronę ' + page + '.',
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
      expect(pageNumbers).toContain(page);
      const metrics = ['revenue', 'ebit', 'netIncome'];
      expect(report.summary).toEqual(
        amounts.map((amount, index) =>
          amount === null
            ? { metric: metrics[index], state: 'missing' }
            : {
                metric: metrics[index],
                state: 'verified',
                amount,
                unit,
                period,
                page,
              },
        ),
      );
    },
    20000,
  );
});
