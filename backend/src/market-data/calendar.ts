import { marketDate, MarketDataError } from './contracts.js';

// Reviewed official calendars. Unsupported years fail closed, never become guessed sessions.
// GPW: https://www.gpw.pl/pub/GPW/uchwaly/2025/753_2025.pdf
// US: https://www.nyse.com/trade/hours-calendars
const holidays: Record<string, string[]> = {
  'XWAR-2026': ['01-01', '01-06', '04-03', '04-06', '05-01', '06-04', '11-11', '12-24', '12-25', '12-31'],
  'US-2026': ['01-01', '01-19', '02-16', '04-03', '05-25', '06-19', '07-03', '09-07', '11-26', '12-25'],
  'US-2027': ['01-01', '01-18', '02-15', '03-26', '05-31', '06-18', '07-05', '09-06', '11-25', '12-24'],
  'US-2028': ['01-17', '02-21', '04-14', '05-29', '06-19', '07-04', '09-04', '11-23', '12-25'],
};
const earlyClose = new Set(['2026-11-27', '2026-12-24', '2027-11-26', '2028-07-03', '2028-11-24']);
function market(mic: string) {
  if (mic === 'XWAR') return { key: 'XWAR', zone: 'Europe/Warsaw', close: 17 * 60 + 5 };
  if (['XNAS', 'XNYS', 'XASE', 'ARCX'].includes(mic)) return { key: 'US', zone: 'America/New_York', close: 16 * 60 };
  throw new MarketDataError('configuration', 'Nieobsługiwany kalendarz rynku.');
}
export function session(mic: string, day: string) {
  marketDate(day);
  const config = market(mic);
  const days = holidays[`${config.key}-${day.slice(0, 4)}`];
  if (!days) throw new MarketDataError('configuration', 'Kalendarz giełdy wymaga aktualizacji dla tego roku.');
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return { trading: weekday !== 0 && weekday !== 6 && !days.includes(day.slice(5)),
    closeMinute: config.key === 'US' && earlyClose.has(day) ? 13 * 60 : config.close, timeZone: config.zone };
}
export function zonedClock(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const value = (key: string) => parts.find(part => part.type === key)!.value;
  return { day: `${value('year')}-${value('month')}-${value('day')}`, minute: Number(value('hour')) * 60 + Number(value('minute')) };
}
export function previousDay(day: string, days = 1) { return new Date(Date.parse(`${day}T12:00:00Z`) - days * 86400000).toISOString().slice(0, 10); }
export function expectedSession(mic: string, now = new Date()): string {
  const clock = zonedClock(now, market(mic).zone);
  let day = clock.day;
  for (let i = 0; i < 15; i++, day = previousDay(day)) {
    const data = session(mic, day);
    // The 90-minute publication allowance is an application policy, not a provider SLA.
    if (data.trading && (day < clock.day || clock.minute >= data.closeMinute + 90)) return day;
  }
  throw new MarketDataError('configuration', 'Brak rozpoznanej zakończonej sesji.');
}
export function quoteFreshness(mic: string, sessionOn: string | null, now = new Date()) {
  const expected = expectedSession(mic, now);
  return { expectedSessionOn: expected, status: !sessionOn ? 'missing' as const : sessionOn < expected ? 'stale' as const : sessionOn > expected ? 'unexpected' as const : 'fresh' as const };
}
export function missingSessions(mic: string, from: string, to: string, available: Set<string>) {
  const missing: string[] = [];
  for (let day = from, i = 0; day <= to && i < 366; day = previousDay(day, -1), i++) if (session(mic, day).trading && !available.has(day)) missing.push(day);
  return missing;
}
