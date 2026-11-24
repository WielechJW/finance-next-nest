import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsIn,
  IsUrl,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsCalendarDate } from '../transactions/transaction-validators.js';

const decimal = /^\d{1,20}(?:\.\d{1,10})?$/;
const money = /^\d{1,20}(?:\.\d{1,2})?$/;
const instant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const currencies = ['PLN', 'USD'] as const;
type Currency = (typeof currencies)[number];

class CashDto {
  @Matches(money) PLN!: string;
  @Matches(money) USD!: string;
}
class OpeningDto {
  @Matches(decimal) price!: string;
  @Matches(decimal) availableQuantity!: string;
}
class SessionDto {
  @IsCalendarDate() sessionOn!: string;
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(instant)
  decidedAt!: string;
  @IsOptional()
  @ValidateNested()
  @IsObject()
  @Type(() => OpeningDto)
  opening?: OpeningDto | null;
}
class BarDto {
  @IsString() @MaxLength(80) id!: string;
  @IsCalendarDate() sessionOn!: string;
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(instant)
  availableAt!: string;
  @Min(1) @IsInt() @Max(2147483647) revision!: number;
  @Matches(decimal) close!: string;
}
class FxMarkDto {
  @IsString() @MaxLength(80) id!: string;
  @IsCalendarDate() sessionOn!: string;
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(instant)
  availableAt!: string;
  @Matches(decimal) usdPln!: string;
}
class ConversionDto {
  @IsCalendarDate() sessionOn!: string;
  @IsIn(currencies) soldCurrency!: Currency;
  @IsIn(currencies) boughtCurrency!: Currency;
  @Matches(money) soldAmount!: string;
  @Matches(money) boughtAmount!: string;
  @IsOptional() @Matches(money) commission?: string;
}
class ActionDto {
  @IsString() @MaxLength(80) id!: string;
  @IsIn(['SPLIT', 'DIVIDEND']) kind!: 'SPLIT' | 'DIVIDEND';
  @IsCalendarDate() exDate!: string;
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(instant)
  availableAt!: string;
  @IsOptional() @Matches(decimal) numerator?: string;
  @IsOptional() @Matches(decimal) denominator?: string;
  @IsOptional() @IsCalendarDate() paymentOn?: string;
  @IsOptional() @Matches(decimal) amountPerShare?: string;
  @IsOptional() @IsInt() @Min(0) @Max(10000) withholdingBps?: number;
}
class CostsDto {
  @Matches(money) commissionFixed!: string;
  @IsInt() @Min(0) @Max(10000) commissionBps!: number;
  @IsInt() @Min(0) @Max(10000) spreadBps!: number;
  @IsInt() @Min(0) @Max(10000) slippageBps!: number;
}

class UniverseMemberDto {
  @Matches(/^[A-Z0-9][A-Z0-9.-]{0,31}$/) ticker!: string;
  @Matches(/^[A-Z0-9]{4}$/) mic!: string;
  @IsIn(currencies) currency!: Currency;
  @IsCalendarDate() listedOn!: string;
  @IsOptional() @IsCalendarDate() delistedOn?: string;
}
class ReportFactDto {
  @Matches(/^[A-Z][A-Z0-9_]{0,60}$/) metric!: string;
  @Matches(/^-?\d{1,20}(?:\.\d{1,10})?$/) amount!: string;
  @IsString() @MaxLength(32) unit!: string;
}
class DatedReportDto {
  @Matches(/^[A-Z0-9][A-Z0-9.-]{0,31}$/) ticker!: string;
  @Matches(/^[A-Z0-9]{4}$/) mic!: string;
  @IsString() @MaxLength(80) id!: string;
  @IsCalendarDate() periodEnd!: string;
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(instant)
  publishedAt!: string;
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(instant)
  availableAt!: string;
  @IsInt() @Min(1) @Max(2147483647) revision!: number;
  @IsIn(['CONSOLIDATED', 'STANDALONE']) scope!: 'CONSOLIDATED' | 'STANDALONE';
  @MaxLength(2048)
  @IsUrl({ protocols: ['https'], require_protocol: true, disallow_auth: true })
  sourceUrl!: string;
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ReportFactDto)
  facts!: ReportFactDto[];
}
class HistoryDto {
  @IsString() @MaxLength(200) source!: string;
  @IsArray()
  @ArrayMaxSize(3000)
  @ValidateNested({ each: true })
  @Type(() => UniverseMemberDto)
  universe!: UniverseMemberDto[];
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => DatedReportDto)
  reports!: DatedReportDto[];
}

export class BacktestInputDto {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => HistoryDto)
  history?: HistoryDto;
  @IsIn(['DEVELOPMENT', 'OUT_OF_SAMPLE']) phase!:
    'DEVELOPMENT' | 'OUT_OF_SAMPLE';
  @IsOptional() @IsUUID() baselineId?: string;
  @IsCalendarDate() fromOn!: string;
  @IsCalendarDate() toOn!: string;
  @IsIn(currencies) reportingCurrency!: Currency;
  @IsIn(['RAW', 'ADJUSTED']) priceBasis!: 'RAW' | 'ADJUSTED';
  @IsDefined() @ValidateNested() @Type(() => CashDto) startingCash!: CashDto;
  @Matches(decimal) orderQuantity!: string;
  @IsInt() @Min(1) @Max(30) maxWaitSessions!: number;
  @IsDefined() @ValidateNested() @Type(() => CostsDto) costs!: CostsDto;
  @IsArray()
  @ArrayMaxSize(370)
  @ValidateNested({ each: true })
  @Type(() => SessionDto)
  sessions!: SessionDto[];
  @IsArray()
  @ArrayMaxSize(2200)
  @ValidateNested({ each: true })
  @Type(() => BarDto)
  bars!: BarDto[];
  @IsArray()
  @ArrayMaxSize(370)
  @ValidateNested({ each: true })
  @Type(() => FxMarkDto)
  fxMarks!: FxMarkDto[];
  @IsArray()
  @ArrayMaxSize(370)
  @ValidateNested({ each: true })
  @Type(() => ConversionDto)
  fx!: ConversionDto[];
  @IsArray()
  @ArrayMaxSize(370)
  @ValidateNested({ each: true })
  @Type(() => ActionDto)
  actions!: ActionDto[];
}
