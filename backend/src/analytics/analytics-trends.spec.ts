import { BadRequestException } from '@nestjs/common';
import { resolveAnalyticsTrends } from './analytics-trends.js';
import type { AnalyticsGranularity } from './analytics-trends.js';
import { AnalyticsTrendsDto } from './dto/analytics-trends.dto.js';

function query(from: string, to: string, granularity: AnalyticsGranularity) {
  return Object.assign(new AnalyticsTrendsDto(), { from, to, granularity });
}

describe('analytics trends calendar limits', () => {
  it.each([
    ['2024-02-28', '2024-03-01', 'day', 3],
    ['2026-03-28', '2026-03-30', 'day', 3],
    ['2026-10-24', '2026-10-26', 'day', 3],
    ['2026-12-31', '2027-01-01', 'day', 2],
    ['1900-02-28', '1900-03-01', 'day', 2],
    ['2000-02-28', '2000-03-01', 'day', 3],
    ['0001-01-01', '0001-01-01', 'day', 1],
    ['9999-12-31', '9999-12-31', 'day', 1],
    ['2024-01-01', '2024-12-31', 'day', 366],
    ['2026-01-01', '2027-01-01', 'day', 366],
    ['2026-11-15', '2026-12-10', 'month', 2],
    ['2026-12-31', '2027-01-01', 'month', 2],
    ['0001-01-01', '0001-01-31', 'month', 1],
    ['9999-12-01', '9999-12-31', 'month', 1],
    ['2020-01-31', '2029-12-01', 'month', 120],
  ] as const)(
    'counts %s through %s by %s as %i points',
    (from, to, granularity, pointCount) => {
      expect(resolveAnalyticsTrends(query(from, to, granularity))).toEqual({
        from,
        to,
        granularity,
        pointCount,
      });
    },
  );

  it.each([
    ['2024-01-01', '2025-01-01', 'day'],
    ['2026-01-01', '2027-01-02', 'day'],
    ['2020-01-31', '2030-01-01', 'month'],
    ['0001-01-01', '9999-12-31', 'day'],
    ['0001-01-01', '9999-12-31', 'month'],
  ] as const)(
    'rejects oversized %s through %s by %s',
    (from, to, granularity) => {
      expect(() =>
        resolveAnalyticsTrends(query(from, to, granularity)),
      ).toThrow(BadRequestException);
    },
  );

  it('defaults to day and the current Warsaw month', () => {
    expect(
      resolveAnalyticsTrends(
        new AnalyticsTrendsDto(),
        new Date('2026-03-31T22:00:00Z'),
      ),
    ).toEqual({
      from: '2026-04-01',
      to: '2026-04-30',
      granularity: 'day',
      pointCount: 30,
    });
  });

  it('defaults a monthly query to the same calendar period', () => {
    const input = Object.assign(new AnalyticsTrendsDto(), {
      granularity: 'month',
    });
    expect(
      resolveAnalyticsTrends(input, new Date('2024-02-15T12:00:00Z')),
    ).toEqual({
      from: '2024-02-01',
      to: '2024-02-29',
      granularity: 'month',
      pointCount: 1,
    });
  });

  it.each([
    { from: '2024-02-01' },
    { to: '2024-02-29' },
    { from: '2024-02-29', to: '2024-02-01' },
  ])(
    'preserves shared validation of incomplete or reversed ranges: %j',
    (range) => {
      expect(() =>
        resolveAnalyticsTrends(Object.assign(new AnalyticsTrendsDto(), range)),
      ).toThrow(BadRequestException);
    },
  );
});
