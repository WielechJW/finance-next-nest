import { Controller, Get, Header, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { IsOptional, IsUUID } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import type { RegisteredUser } from '../users/users.service.js';
import { PriceHistoryDto } from '../market-data/instruments.controller.js';
import { PortfolioValuationService } from './valuation.service.js';

export class ValuationHistoryDto extends PriceHistoryDto { @IsOptional() @IsUUID() benchmarkId?: string; }
@Controller('investments/portfolios/:portfolioId')
@UseGuards(SessionAuthGuard)
export class PortfolioValuationController {
  constructor(private readonly valuations: PortfolioValuationService) {}
  @Get('valuation') @Header('Cache-Control', 'no-store')
  current(@CurrentUser() user: RegisteredUser, @Param('portfolioId', ParseUUIDPipe) id: string) { return this.valuations.current(user.id, id); }
  @Get('valuations') @Header('Cache-Control', 'no-store')
  history(@CurrentUser() user: RegisteredUser, @Param('portfolioId', ParseUUIDPipe) id: string, @Query() query: ValuationHistoryDto) { return this.valuations.history(user.id, id, query.from, query.to, query.benchmarkId); }
}
