import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Equals, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { IsCalendarDate } from '../transactions/transaction-validators.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import type { RegisteredUser } from '../users/users.service.js';
import { CorporateActionsService } from './corporate-actions.service.js';

class ConfirmCorporateActionDto {
  @IsInt() @Min(1) @Max(2147483647) expectedRevision: number;
  @IsString() @Length(1, 128) idempotencyKey: string;
  @IsCalendarDate() occurredOn: string;
  @IsInt() @Min(1) @Max(2147483647) daySequence: number;
  @Equals(true) acknowledged: boolean;
  @IsOptional() @IsString() @Length(1, 40) grossAmount?: string;
  @IsOptional() @IsString() @Length(1, 40) withholdingTax?: string;
  @IsOptional() @IsString() @Length(1, 40) fee?: string;
}
@Controller('investments/portfolios/:portfolioId/accounts/:accountId/corporate-actions')
@UseGuards(SessionAuthGuard)
export class CorporateActionsController {
  constructor(private readonly actions: CorporateActionsService) {}
  @Get() @Header('Cache-Control', 'no-store')
  list(@CurrentUser() user: RegisteredUser, @Param('portfolioId', ParseUUIDPipe) p: string, @Param('accountId', ParseUUIDPipe) a: string) { return this.actions.proposals(user.id, p, a); }
  @Post(':actionId/confirm') @Header('Cache-Control', 'no-store')
  confirm(@CurrentUser() user: RegisteredUser, @Param('portfolioId', ParseUUIDPipe) p: string, @Param('accountId', ParseUUIDPipe) a: string,
    @Param('actionId', ParseUUIDPipe) action: string, @Body() input: ConfirmCorporateActionDto) { return this.actions.confirm(user.id, p, a, action, input); }
}
