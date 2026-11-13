import { BadRequestException } from '@nestjs/common';
import type { AnalyticsPeriodDto } from './dto/analytics-period.dto.js';

export interface AnalyticsPeriod {
  from: string;
  to: string;
}

const warsawCalendar = new Intl.DateTimeFormat('en', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: '2-digit',
});

/** Resolve a validated query to a closed calendar range shared by reports. */
export function resolveAnalyticsPeriod(
  input: AnalyticsPeriodDto,
  now = new Date(),
): AnalyticsPeriod {
  if (input.from === undefined && input.to === undefined) {
    const parts = warsawCalendar.formatToParts(now);
    const year = parts
      .find((part) => part.type === 'year')!
      .value.padStart(4, '0');
    const month = parts.find((part) => part.type === 'month')!.value;
    const leapYear =
      Number(year) % 4 === 0 &&
      (Number(year) % 100 !== 0 || Number(year) % 400 === 0);
    const days = [
      31,
      leapYear ? 29 : 28,
      31,
      30,
      31,
      30,
      31,
      31,
      30,
      31,
      30,
      31,
    ];
    return {
      from: `${year}-${month}-01`,
      to: `${year}-${month}-${days[Number(month) - 1]}`,
    };
  }

  if (input.from === undefined || input.to === undefined) {
    throw new BadRequestException('Podaj obie daty: od i do.');
  }
  if (input.from > input.to) {
    throw new BadRequestException(
      'Data od nie może być późniejsza niż data do.',
    );
  }
  return { from: input.from, to: input.to };
}
