import { zonedClock } from '../market-data/calendar.js';
export function quietUntil(
  settings: { quietStart: number; quietEnd: number; timeZone: string },
  now: Date,
): Date | null {
  if (settings.quietStart === settings.quietEnd) return null;
  const quiet = (date: Date) => {
    const minute = zonedClock(date, settings.timeZone).minute;
    return settings.quietStart < settings.quietEnd
      ? minute >= settings.quietStart && minute < settings.quietEnd
      : minute >= settings.quietStart || minute < settings.quietEnd;
  };
  if (!quiet(now)) return null;
  for (let i = 1; i <= 1500; i++) {
    const date = new Date(now.getTime() + i * 60000);
    if (!quiet(date)) return date;
  }
  return new Date(now.getTime() + 86400000);
}
