export type InvestmentTimingInput = {
  occurredOn: string;
  timePrecision: 'DATE' | 'INSTANT';
  executedAt?: string;
  sourceTimeZone?: string;
  marketSessionOn?: string;
  settledOn?: string;
  daySequence: number;
};

function calendarDate(value: string, field: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) {
    throw new Error(`${field} must be a calendar date in YYYY-MM-DD format.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${field} is not a calendar date.`);
  }
  return date;
}

export { calendarDate as parseInvestmentCalendarDate };

function dateInWarsaw(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}

function localClock(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}`;
}

function instant(value: string): Date {
  // An offset is mandatory: a source-local wall clock alone may be ambiguous at DST.
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new Error('executedAt must include a UTC offset.');
  calendarDate(match[1], 'executedAt');
  if (+match[2] > 23 || +match[3] > 59 || +match[4] > 59) {
    throw new Error('executedAt has an invalid clock time.');
  }
  if (match[6] !== 'Z') {
    const hours = +match[6].slice(1, 3);
    const minutes = +match[6].slice(4, 6);
    if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) {
      throw new Error('executedAt has an invalid UTC offset.');
    }
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error('executedAt is not a valid instant.');
  }
  return parsed;
}

function sourceZone(value: string | undefined): string | null {
  if (value === undefined) return null;
  if (
    value !== value.trim() || value.length === 0 || value.length > 64 ||
    !/^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+)$/.test(value)
  ) {
    throw new Error('sourceTimeZone must be a valid IANA time zone.');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
  } catch {
    throw new Error('sourceTimeZone must be a valid IANA time zone.');
  }
  return value;
}

/** Validates the future investment API's timing fields before a database write. */
export function parseInvestmentTiming(input: InvestmentTimingInput, now = new Date()) {
  const occurredOn = calendarDate(input.occurredOn, 'occurredOn');
  if (input.occurredOn > dateInWarsaw(now)) {
    throw new Error('Investment events cannot have a future accounting date.');
  }
  if (
    !Number.isInteger(input.daySequence) ||
    input.daySequence < 1 ||
    input.daySequence > 2147483647
  ) {
    throw new Error('daySequence must be a positive 32-bit integer.');
  }
  const sourceTimeZone = sourceZone(input.sourceTimeZone);
  let executedAt: Date | null = null;
  if (input.timePrecision === 'INSTANT') {
    if (input.executedAt === undefined || sourceTimeZone === null) {
      throw new Error('An instant requires executedAt and sourceTimeZone.');
    }
    executedAt = instant(input.executedAt);
    if (executedAt > now) throw new Error('executedAt cannot be in the future.');
    if (localClock(executedAt, sourceTimeZone) !== input.executedAt.slice(0, 19)) {
      throw new Error('executedAt does not exist in sourceTimeZone at the supplied offset.');
    }
    if (dateInWarsaw(executedAt) !== input.occurredOn) {
      throw new Error('occurredOn must match the execution date in Europe/Warsaw.');
    }
  } else if (input.timePrecision === 'DATE') {
    if (input.executedAt !== undefined) {
      throw new Error('A date-only event cannot have executedAt.');
    }
  } else {
    throw new Error('timePrecision must be DATE or INSTANT.');
  }
  return {
    occurredOn,
    timePrecision: input.timePrecision,
    executedAt,
    sourceTimeZone,
    marketSessionOn: input.marketSessionOn === undefined
      ? null
      : calendarDate(input.marketSessionOn, 'marketSessionOn'),
    settledOn: input.settledOn === undefined
      ? null
      : calendarDate(input.settledOn, 'settledOn'),
    daySequence: input.daySequence,
  };
}
