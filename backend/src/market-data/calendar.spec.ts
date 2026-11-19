import { expectedSession, missingSessions, quoteFreshness, session } from './calendar.js';

describe('Reviewed exchange calendars and freshness', () => {
  it('keeps Friday quotes fresh over a weekend and distinguishes Polish and US holidays', () => {
    expect(quoteFreshness('XWAR', '2026-11-13', new Date('2026-11-15T20:00:00Z')).status).toBe('fresh');
    expect(session('XWAR', '2026-11-11').trading).toBe(false);
    expect(session('XNYS', '2026-11-11').trading).toBe(true);
    expect(session('XNYS', '2026-11-26').trading).toBe(false);
    expect(session('XWAR', '2026-11-26').trading).toBe(true);
  });
  it('uses New York time across independently changing DST instead of a fixed Warsaw offset', () => {
    expect(expectedSession('XNYS', new Date('2026-03-20T21:00:00Z'))).toBe('2026-03-19');
    expect(expectedSession('XNYS', new Date('2026-03-20T21:31:00Z'))).toBe('2026-03-20');
    expect(expectedSession('XNYS', new Date('2026-11-18T21:31:00Z'))).toBe('2026-11-17');
    expect(expectedSession('XNYS', new Date('2026-11-18T22:31:00Z'))).toBe('2026-11-18');
  });
  it('accounts for shortened US sessions and flags missing or stale data without treating a holiday as an outage', () => {
    expect(session('XNYS', '2026-11-27').closeMinute).toBe(13 * 60);
    expect(expectedSession('XNYS', new Date('2026-11-27T19:31:00Z'))).toBe('2026-11-27');
    expect(quoteFreshness('XNYS', null, new Date('2026-11-27T19:31:00Z')).status).toBe('missing');
    expect(missingSessions('XWAR', '2026-11-10', '2026-11-12', new Set(['2026-11-10']))).toEqual(['2026-11-12']);
  });
  it('uses the 2027 GPW resolution, including the first session and year-end closures', () => {
    for (const day of ['01-01', '01-06', '03-26', '03-29', '05-03', '05-27', '11-01', '11-11', '12-24', '12-31'])
      expect(session('XWAR', '2027-' + day).trading).toBe(false);
    expect(expectedSession('XWAR', new Date('2027-01-03T22:00:00Z'))).toBe('2026-12-30');
    expect(expectedSession('XWAR', new Date('2027-01-04T22:00:00Z'))).toBe('2027-01-04');
  });
  it('refuses to invent holidays for an unreviewed year', () => {
    expect(() => session('XWAR', '2030-01-02')).toThrow('Kalendarz');
  });
});
