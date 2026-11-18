import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { MarketInstrumentsService } from './instruments.service.js';

export class InstrumentSearchDto {
  @IsOptional() @IsString() @MaxLength(80) q?: string;
  @IsOptional() @IsIn(['XWAR', 'XNAS', 'XNYS', 'XASE', 'ARCX']) mic?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
}
@Controller('market-data/instruments')
@UseGuards(SessionAuthGuard)
export class MarketInstrumentsController {
  constructor(private readonly instruments: MarketInstrumentsService) {}
  @Get() @Header('Cache-Control', 'no-store')
  search(@Query() query: InstrumentSearchDto) { return this.instruments.search(query); }
}
