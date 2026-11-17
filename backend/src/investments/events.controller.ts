import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import type { RegisteredUser } from '../users/users.service.js';
import { CorrectInvestmentEventDto, CreateInvestmentEventDto, ListInvestmentEventsDto } from './dto/event.dto.js';
import { InvestmentEventsService } from './events.service.js';

@Controller('investments/portfolios/:portfolioId/accounts/:accountId')
@UseGuards(SessionAuthGuard)
export class InvestmentEventsController {
  constructor(private readonly events: InvestmentEventsService) {}

  @Get('events')
  @Header('Cache-Control', 'no-store')
  list(@CurrentUser() user: RegisteredUser, @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string, @Query() input: ListInvestmentEventsDto) {
    return this.events.list(user.id, portfolioId, accountId, input);
  }

  @Post('events')
  @Header('Cache-Control', 'no-store')
  post(@CurrentUser() user: RegisteredUser, @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string, @Body() input: CreateInvestmentEventDto) {
    return this.events.post(user.id, portfolioId, accountId, input);
  }

  @Get('events/:eventId')
  @Header('Cache-Control', 'no-store')
  get(@CurrentUser() user: RegisteredUser, @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string, @Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.events.get(user.id, portfolioId, accountId, eventId);
  }

  @Post('events/:eventId/corrections')
  @Header('Cache-Control', 'no-store')
  correct(@CurrentUser() user: RegisteredUser, @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string, @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() input: CorrectInvestmentEventDto) {
    return this.events.correct(user.id, portfolioId, accountId, eventId, input);
  }

  @Get('summary')
  @Header('Cache-Control', 'no-store')
  summary(@CurrentUser() user: RegisteredUser, @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string) {
    return this.events.summary(user.id, portfolioId, accountId);
  }
}

@Controller('investments/instruments')
@UseGuards(SessionAuthGuard)
export class InvestmentInstrumentsController {
  constructor(private readonly events: InvestmentEventsService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  list() { return this.events.instruments(); }
}
