import { IsEnum, ValidateIf } from 'class-validator';
import { TransactionType } from '../../generated/prisma/client.js';

export class ListCategoriesDto {
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsEnum(TransactionType, { message: 'Typ musi być INCOME albo EXPENSE.' })
  type?: TransactionType;
}
