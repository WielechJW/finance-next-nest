import { BadRequestException } from '@nestjs/common';
import { resolveAnalyticsPeriod } from './analytics-period.js';

describe('analytics calendar period', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['2026-11-13T12:00:00Z', '2026-11-01', '2026-11-30'],
    ['2026-01-31T23:30:00Z', '2026-02-01', '2026-02-28'],
    ['2024-02-15T12:00:00Z', '2024-02-01', '2024-02-29'],
    ['2100-02-15T12:00:00Z', '2100-02-01', '2100-02-28'],
    ['2000-02-15T12:00:00Z', '2000-02-01', '2000-02-29'],
    ['2026-03-31T21:59:59Z', '2026-03-01', '2026-03-31'],
    ['2026-03-31T22:00:00Z', '2026-04-01', '2026-04-30'],
    ['2026-12-31T23:00:00Z', '2027-01-01', '2027-01-31'],
    ['0001-01-15T12:00:00Z', '0001-01-01', '0001-01-31'],
    ['9999-12-15T12:00:00Z', '9999-12-01', '9999-12-31'],
  ])('defaults at %s to %s through %s in Warsaw', (instant, from, to) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(instant));
    expect(resolveAnalyticsPeriod({})).toEqual({ from, to });
  });

  it.each([
    { from: '2024-02-29', to: '2024-02-29' },
    { from: '2026-12-31', to: '2027-01-01' },
    { from: '0001-01-01', to: '9999-12-31' },
  ])('preserves an explicit calendar range $from through $to', (period) => {
    expect(resolveAnalyticsPeriod(period)).toEqual(period);
  });

  it.each([
    { from: '2026-11-01' },
    { to: '2026-11-30' },
    { from: '2026-11-30', to: '2026-11-01' },
  ])('rejects an incomplete or reversed range: %j', (period) => {
    expect(() => resolveAnalyticsPeriod(period)).toThrow(BadRequestException);
  });
});
