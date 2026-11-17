import { Transform, Type } from 'class-transformer';
import {
  IsDefined, IsEnum, IsIn, IsInt, IsObject, IsString, IsUUID, Length, Max, Min, ValidateIf, ValidateNested,
} from 'class-validator';
import { InvestmentCurrency, InvestmentEventType } from '../../generated/prisma/client.js';
import { IsCalendarDate } from '../../transactions/transaction-validators.js';

export const manualEventTypes = ['DEPOSIT', 'WITHDRAWAL', 'BUY', 'SELL', 'DIVIDEND', 'FEE', 'FX', 'OPENING_POSITION'] as const;
const optional = (_object: unknown, value: unknown) => value !== undefined;

export class CreateInvestmentEventDto {
  @IsIn(manualEventTypes) type!: typeof manualEventTypes[number];
  @IsString() @Length(1, 128) idempotencyKey!: string;
  @IsCalendarDate() occurredOn!: string;
  @IsIn(['DATE', 'INSTANT']) timePrecision!: 'DATE' | 'INSTANT';
  @IsInt() @Min(1) @Max(2147483647) daySequence!: number;
  @ValidateIf(optional) @IsString() @Length(1, 64) executedAt?: string;
  @ValidateIf(optional) @IsString() @Length(1, 64) sourceTimeZone?: string;
  @ValidateIf(optional) @IsCalendarDate() marketSessionOn?: string;
  @ValidateIf(optional) @IsCalendarDate() settledOn?: string;
  @ValidateIf(optional) @IsEnum(InvestmentCurrency) currency?: InvestmentCurrency;
  @ValidateIf(optional) @IsUUID() instrumentId?: string;
  @ValidateIf(optional) @IsString() @Length(1, 40) amount?: string;
  @ValidateIf(optional) @IsString() @Length(1, 40) quantity?: string;
  @ValidateIf(optional) @IsString() @Length(1, 40) unitPrice?: string;
  @ValidateIf(optional) @IsString() @Length(1, 40) commission?: string;
  @ValidateIf(optional) @IsString() @Length(1, 40) grossAmount?: string;
  @ValidateIf(optional) @IsString() @Length(1, 40) withholdingTax?: string;
  @ValidateIf(optional) @IsString() @Length(1, 40) fee?: string;
  @ValidateIf(optional) @IsString() @Length(1, 40) totalCost?: string;
  @ValidateIf(optional) @IsCalendarDate() acquiredOn?: string;
  @ValidateIf(optional) @IsEnum(InvestmentCurrency) soldCurrency?: InvestmentCurrency;
  @ValidateIf(optional) @IsEnum(InvestmentCurrency) boughtCurrency?: InvestmentCurrency;
  @ValidateIf(optional) @IsString() @Length(1, 40) soldAmount?: string;
  @ValidateIf(optional) @IsString() @Length(1, 40) boughtAmount?: string;
}

export class CorrectInvestmentEventDto {
  @IsInt() @Min(0) @Max(2147483646) expectedRevision!: number;
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(1, 500) reason!: string;
  @IsString() @Length(1, 128) idempotencyKey!: string;
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsDefined() @IsObject() @ValidateNested() @Type(() => CreateInvestmentEventDto)
  replacement!: CreateInvestmentEventDto | null;
}

function integer(value: unknown) {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value;
}

export class ListInvestmentEventsDto {
  @ValidateIf(optional) @IsEnum(InvestmentEventType) type?: InvestmentEventType;
  @ValidateIf(optional) @IsUUID() instrumentId?: string;
  @ValidateIf(optional) @IsCalendarDate() from?: string;
  @ValidateIf(optional) @IsCalendarDate() to?: string;
  @IsIn(['effective', 'audit']) view: 'effective' | 'audit' = 'effective';
  @Transform(({ value }: { value: unknown }) => integer(value))
  @IsInt() @Min(1) @Max(2147483647) page = 1;
  @Transform(({ value }: { value: unknown }) => integer(value))
  @IsInt() @Min(1) @Max(100) pageSize = 20;
}
