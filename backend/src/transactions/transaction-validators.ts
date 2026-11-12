import { ValidateBy, type ValidationOptions } from 'class-validator';

export function IsTransactionAmount(
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isTransactionAmount',
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' &&
          value === value.trim() &&
          /^(?:0|[1-9]\d{0,11})\.\d{2}$/.test(value) &&
          value !== '0.00',
        defaultMessage: () =>
          'Podaj dodatnią kwotę z kropką i dwoma miejscami po przecinku, od 0.01 do 999999999999.99.',
      },
    },
    options,
  );
}

export function IsCalendarDate(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isCalendarDate',
      validator: {
        validate: (value: unknown) => {
          if (
            typeof value !== 'string' ||
            value.length !== 10 ||
            !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
            value.startsWith('0000-')
          ) {
            return false;
          }

          // Date normalizes days such as February 30; reject that rollover.
          const date = new Date(value + 'T00:00:00.000Z');
          return (
            Number.isFinite(date.getTime()) &&
            date.toISOString().slice(0, 10) === value
          );
        },
        defaultMessage: () =>
          'Podaj istniejącą datę YYYY-MM-DD od 0001-01-01 do 9999-12-31.',
      },
    },
    options,
  );
}
