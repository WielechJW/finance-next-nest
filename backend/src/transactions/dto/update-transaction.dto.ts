import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { TransactionType } from '../../generated/prisma/client.js';
import {
  IsCalendarDate,
  IsTransactionAmount,
} from '../transaction-validators.js';

export class UpdateTransactionDto {
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsEnum(TransactionType, { message: 'Typ musi być INCOME albo EXPENSE.' })
  type?: TransactionType;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsTransactionAmount()
  amount?: string;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsUUID('all', {
    message: 'Kategoria musi mieć poprawny identyfikator UUID.',
  })
  categoryId?: string;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'Tytuł musi być tekstem.' })
  @Length(1, 100, { message: 'Tytuł musi mieć od 1 do 100 znaków.' })
  title?: string;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsCalendarDate()
  occurredOn?: string;

  @ValidateIf(
    (_object: unknown, value: unknown) => value !== undefined && value !== null,
  )
  @IsString({ message: 'Notatka musi być tekstem.' })
  @MaxLength(1000, { message: 'Notatka może mieć najwyżej 1000 znaków.' })
  note?: string | null;
}
