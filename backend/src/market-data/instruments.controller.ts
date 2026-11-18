import { BadRequestException, Controller, Get, Header, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { MarketInstrumentsService } from './instruments.service.js';
import { MarketHistoryService } from './history.service.js';
import { MarketQualityService } from './quality.service.js';

export class PriceHistoryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) from: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) to: string;
}

export class InstrumentSearchDto {
  @IsOptional() @IsString() @MaxLength(80) q?: string;
  @IsOptional() @IsIn(['XWAR', 'XNAS', 'XNYS', 'XASE', 'ARCX']) mic?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
}
@Controller('market-data/instruments')
@UseGuards(SessionAuthGuard)
export class MarketInstrumentsController {
  constructor(private readonly instruments: MarketInstrumentsService, private readonly history: MarketHistoryService, private readonly quality: MarketQualityService) {}
  @Get() @Header('Cache-Control', 'no-store')
  search(@Query() query: InstrumentSearchDto) { return this.instruments.search(query); }
  @Get(':instrumentId/quote') @Header('Cache-Control', 'no-store')
  quote(@Param('instrumentId', ParseUUIDPipe) instrumentId: string) { return this.quality.quote(instrumentId); }
  @Get(':instrumentId/prices') @Header('Cache-Control', 'no-store')
  prices(@Param('instrumentId', ParseUUIDPipe) instrumentId: string, @Query() query: PriceHistoryDto) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(query.from) || !/^\d{4}-\d{2}-\d{2}$/.test(query.to) || query.from > query.to || Date.parse(query.to) - Date.parse(query.from) > 365 * 86400000) throw new BadRequestException('Podaj zakres dat do jednego roku.');
    return this.history.prices(instrumentId, query.from, query.to);
  }
}
