import { BadRequestException } from '@nestjs/common';
import { resolveAnalyticsPeriod } from './analytics-period.js';
import type { AnalyticsTrendsDto } from './dto/analytics-trends.dto.js';

export type AnalyticsGranularity = 'day' | 'month';
export const MAX_DAILY_POINTS = 366;
export const MAX_MONTHLY_POINTS = 120;

// Gregorian day numbers avoid timestamps, time zones and DST when counting
// a validated calendar range, including years 0001 through 9999.
function calendarDayNumber(value: string): number {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const previousYear = year - 1;
  const beforeYear =
    365 * previousYear +
    Math.floor(previousYear / 4) -
    Math.floor(previousYear / 100) +
    Math.floor(previousYear / 400);
  const beforeMonth = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return (
    beforeYear + beforeMonth[month - 1]! + day + (month > 2 && leapYear ? 1 : 0)
  );
}

export function resolveAnalyticsTrends(
  input: AnalyticsTrendsDto,
  now = new Date(),
) {
  const period = resolveAnalyticsPeriod(input, now);
  const granularity = input.granularity;
  const pointCount =
    granularity === 'day'
      ? calendarDayNumber(period.to) - calendarDayNumber(period.from) + 1
      : (Number(period.to.slice(0, 4)) - Number(period.from.slice(0, 4))) * 12 +
        Number(period.to.slice(5, 7)) -
        Number(period.from.slice(5, 7)) +
        1;

  if (
    pointCount > (granularity === 'day' ? MAX_DAILY_POINTS : MAX_MONTHLY_POINTS)
  ) {
    throw new BadRequestException(
      granularity === 'day'
        ? 'Raport dzienny może obejmować najwyżej 366 dni.'
        : 'Raport miesięczny może obejmować najwyżej 120 miesięcy.',
    );
  }
  return { ...period, granularity, pointCount };
}
