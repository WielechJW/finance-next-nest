import { ValidateIf } from 'class-validator';
import { IsCalendarDate } from '../../transactions/transaction-validators.js';

export class AnalyticsPeriodDto {
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsCalendarDate()
  from?: string;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsCalendarDate()
  to?: string;
}
