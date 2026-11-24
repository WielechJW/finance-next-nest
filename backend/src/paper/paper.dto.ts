import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsCalendarDate } from '../transactions/transaction-validators.js';

const amount = /^\d{1,20}(?:\.\d{1,2})?$/;
const lots = /^\d{1,18}(?:\.\d{1,10})?$/;
const utc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const identifier = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

class PaperCashDto {
  @Matches(amount) PLN!: string;
  @Matches(amount) USD!: string;
}
export class PaperConnectionDto {
  @Transform(trim) @IsString() @Length(1, 100) name!: string;
  @IsUUID() idempotencyKey!: string;
  @IsCalendarDate() openingOn!: string;
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => PaperCashDto)
  cash!: PaperCashDto;
}
export class PaperOrderDto {
  @IsOptional() @IsUUID() signalId?: string;
  @IsUUID() instrumentId!: string;
  @IsUUID() idempotencyKey!: string;
  @IsIn(['BUY', 'SELL']) side!: 'BUY' | 'SELL';
  @IsIn(['MARKET', 'LIMIT']) type!: 'MARKET' | 'LIMIT';
  @Matches(lots) quantity!: string;
  @IsOptional() @Matches(lots) limitPrice?: string;
}
class FillDto {
  @Matches(identifier) executionId!: string;
  @IsInt() @Min(3) @Max(2147483647) daySequence!: number;
  @Matches(lots) quantity!: string;
  @Matches(lots) price!: string;
  @Matches(amount) fee!: string;
}
export class PaperEventDto {
  @Matches(identifier) externalEventId!: string;
  @IsIn(['SENT', 'ACCEPTED', 'FILL', 'REJECTED', 'CANCELLED']) kind!:
    'SENT' | 'ACCEPTED' | 'FILL' | 'REJECTED' | 'CANCELLED';
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(utc)
  happenedAt!: string;
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => FillDto)
  fill?: FillDto;
}

export class SubmitPaperOrderDto {
  @IsOptional()
  @IsIn(['NONE', 'BEFORE_RECEIPT', 'AFTER_RECEIPT', 'SESSION_EXPIRED'])
  fault?: 'NONE' | 'BEFORE_RECEIPT' | 'AFTER_RECEIPT' | 'SESSION_EXPIRED';
}

class SimulatedFillDto {
  @Matches(lots) quantity!: string;
  @Matches(lots) price!: string;
  @Matches(amount) fee!: string;
}

export class SimulatePaperEventDto {
  @IsUUID() idempotencyKey!: string;
  @IsIn(['FILL', 'REJECTED', 'CANCELLED']) kind!:
    'FILL' | 'REJECTED' | 'CANCELLED';
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SimulatedFillDto)
  fill?: SimulatedFillDto;
}
