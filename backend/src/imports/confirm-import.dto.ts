import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsCalendarDate } from '../transactions/transaction-validators.js';

class BrokerCashDto {
  @Matches(/^\d{1,20}(?:\.\d{1,2})?$/) PLN!: string;
  @Matches(/^\d{1,20}(?:\.\d{1,2})?$/) USD!: string;
}
class BrokerPositionDto {
  @IsUUID() instrumentId!: string;
  @Matches(/^\d{1,18}(?:\.\d{1,10})?$/) quantity!: string;
}
class DecisionDto {
  @IsInt() @Min(1) @Max(2147483647) number!: number;
  @IsIn(['KEEP', 'SKIP']) action!: 'KEEP' | 'SKIP';
}
export class ConfirmImportDto {
  @IsBoolean() completeHistory!: boolean;
  @IsOptional() @IsCalendarDate() openingOn?: string;
  @IsOptional() @IsBoolean() openingEmpty?: boolean;
  @IsCalendarDate() asOf!: string;
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => BrokerCashDto)
  cash!: BrokerCashDto;
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => BrokerPositionDto)
  positions!: BrokerPositionDto[];
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => DecisionDto)
  decisions!: DecisionDto[];
}
