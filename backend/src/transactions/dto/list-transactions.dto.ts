import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsUUID, Max, Min, ValidateIf } from 'class-validator';
import { TransactionType } from '../../generated/prisma/client.js';
import { IsCalendarDate } from '../transaction-validators.js';

// Bound pagination offsets before passing them to Prisma.
export const MAX_TRANSACTION_OFFSET = 2_147_483_647;

function parseInteger(value: unknown): unknown {
  return typeof value === 'string' &&
    value === value.trim() &&
    /^[1-9]\d*$/.test(value)
    ? Number(value)
    : value;
}

export class ListTransactionsDto {
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsEnum(TransactionType, { message: 'Typ musi być INCOME albo EXPENSE.' })
  type?: TransactionType;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsUUID('all', {
    message: 'Kategoria musi mieć poprawny identyfikator UUID.',
  })
  categoryId?: string;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsCalendarDate()
  from?: string;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsCalendarDate()
  to?: string;

  @Transform(({ value }: { value: unknown }) => parseInteger(value))
  @IsInt({ message: 'Numer strony musi być dodatnią liczbą całkowitą.' })
  @Min(1, { message: 'Numer strony musi być większy od zera.' })
  @Max(MAX_TRANSACTION_OFFSET, { message: 'Numer strony jest zbyt duży.' })
  page = 1;

  @Transform(({ value }: { value: unknown }) => parseInteger(value))
  @IsInt({ message: 'Rozmiar strony musi być liczbą całkowitą od 1 do 100.' })
  @Min(1, { message: 'Rozmiar strony musi być większy od zera.' })
  @Max(100, { message: 'Strona może zawierać najwyżej 100 transakcji.' })
  pageSize = 20;
}
