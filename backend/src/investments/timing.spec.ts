import { parseInvestmentTiming } from './timing.js';

const now = new Date('2026-11-16T12:00:00.000Z');

describe('investment event timing', () => {
  it('keeps a date-only event without inventing an execution time', () => {
    const timing = parseInvestmentTiming({
      occurredOn: '2026-11-10',
      timePrecision: 'DATE',
      daySequence: 1,
      settledOn: '2026-11-18',
    }, now);
    expect(timing.occurredOn.toISOString()).toBe('2026-11-10T00:00:00.000Z');
    expect(timing.executedAt).toBeNull();
    expect(timing.settledOn?.toISOString()).toBe('2026-11-18T00:00:00.000Z');
  });

  it('records a New York execution and its distinct Warsaw accounting date', () => {
    const timing = parseInvestmentTiming({
      occurredOn: '2026-01-16',
      timePrecision: 'INSTANT',
      executedAt: '2026-01-15T23:30:00-05:00',
      sourceTimeZone: 'America/New_York',
      marketSessionOn: '2026-01-15',
      daySequence: 2,
    }, now);
    expect(timing.executedAt?.toISOString()).toBe('2026-01-16T04:30:00.000Z');
    expect(timing.marketSessionOn?.toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });

  it('accepts an ambiguous local clock only with its correct explicit offset', () => {
    const base = {
      occurredOn: '2026-11-01',
      timePrecision: 'INSTANT' as const,
      sourceTimeZone: 'America/New_York',
      daySequence: 1,
    };
    expect(parseInvestmentTiming({ ...base, executedAt: '2026-11-01T01:30:00-04:00' }, now)
      .executedAt?.toISOString()).toBe('2026-11-01T05:30:00.000Z');
    expect(parseInvestmentTiming({ ...base, executedAt: '2026-11-01T01:30:00-05:00' }, now)
      .executedAt?.toISOString()).toBe('2026-11-01T06:30:00.000Z');
  });

  it.each([
    { occurredOn: '2026-02-30', timePrecision: 'DATE' as const, daySequence: 1 },
    { occurredOn: '2026-11-17', timePrecision: 'DATE' as const, daySequence: 1 },
    { occurredOn: '2026-11-10', timePrecision: 'DATE' as const, daySequence: 0 },
    { occurredOn: '2026-11-10', timePrecision: 'DATE' as const, daySequence: 1, executedAt: '2026-11-10T10:00:00Z' },
    { occurredOn: '2026-01-16', timePrecision: 'INSTANT' as const, daySequence: 1, executedAt: '2026-01-15T23:30:00' },
    { occurredOn: '2026-01-15', timePrecision: 'INSTANT' as const, daySequence: 1, executedAt: '2026-01-15T23:30:00-05:00', sourceTimeZone: 'America/New_York' },
    { occurredOn: '2026-03-08', timePrecision: 'INSTANT' as const, daySequence: 1, executedAt: '2026-03-08T02:30:00-05:00', sourceTimeZone: 'America/New_York' },
    { occurredOn: '2026-11-16', timePrecision: 'INSTANT' as const, daySequence: 1, executedAt: '2026-11-16T14:00:00+01:00', sourceTimeZone: 'Europe/Warsaw' },
    { occurredOn: '2026-01-16', timePrecision: 'INSTANT' as const, daySequence: 1, executedAt: '2026-01-15T23:30:00-05:00', sourceTimeZone: 'Bad/Zone' },
  ])('rejects invalid or future timing %#', (input) => {
    expect(() => parseInvestmentTiming(input, now)).toThrow();
  });
});
