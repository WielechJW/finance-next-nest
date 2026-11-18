import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import type { RegisteredUser } from '../users/users.service.js';
import { InvestmentNameDto } from '../investments/dto/account.dto.js';
import { WatchlistsService } from './watchlists.service.js';
import { PriceAlertsService } from './alerts.service.js';

class InstrumentDto { @IsUUID() instrumentId: string; }
class NewAlertDto extends InstrumentDto {
  @IsIn(['ABOVE', 'BELOW']) direction: 'ABOVE' | 'BELOW';
  @IsIn(['ONCE', 'REARM']) mode: 'ONCE' | 'REARM';
  @IsString() @Length(1, 40) @Matches(/^(?:0|[1-9]\d*)(?:\.\d{1,10})?$/) threshold: string;
  @IsInt() @Min(0) @Max(525600) cooldownMinutes = 1440;
}
class UpdateAlertDto { @IsBoolean() active: boolean; }
class AlertHistoryDto { @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1; }
@Controller('watchlists') @UseGuards(SessionAuthGuard)
export class WatchlistsController {
  constructor(private readonly lists: WatchlistsService) {}
  @Get() @Header('Cache-Control', 'no-store') list(@CurrentUser() u: RegisteredUser) { return this.lists.list(u.id); }
  @Post() create(@CurrentUser() u: RegisteredUser, @Body() input: InvestmentNameDto) { return this.lists.create(u.id, input.name); }
  @Patch(':id') rename(@CurrentUser() u: RegisteredUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: InvestmentNameDto) { return this.lists.rename(u.id, id, input.name); }
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: RegisteredUser, @Param('id', ParseUUIDPipe) id: string) { return this.lists.remove(u.id, id); }
  @Post(':id/items') add(@CurrentUser() u: RegisteredUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: InstrumentDto) { return this.lists.add(u.id, id, input.instrumentId); }
  @Delete(':id/items/:instrumentId') @HttpCode(204) removeItem(@CurrentUser() u: RegisteredUser, @Param('id', ParseUUIDPipe) id: string, @Param('instrumentId', ParseUUIDPipe) instrumentId: string) { return this.lists.removeItem(u.id, id, instrumentId); }
}
@Controller('price-alerts') @UseGuards(SessionAuthGuard)
export class PriceAlertsController {
  constructor(private readonly alerts: PriceAlertsService) {}
  @Get() @Header('Cache-Control', 'no-store') list(@CurrentUser() u: RegisteredUser) { return this.alerts.list(u.id); }
  @Post() create(@CurrentUser() u: RegisteredUser, @Body() input: NewAlertDto) { return this.alerts.create(u.id, input); }
  @Get('events') @Header('Cache-Control', 'no-store') events(@CurrentUser() u: RegisteredUser, @Query() query: AlertHistoryDto) { return this.alerts.history(u.id, query.page); }
  @Patch(':id') update(@CurrentUser() u: RegisteredUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: UpdateAlertDto) { return this.alerts.update(u.id, id, input.active); }
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: RegisteredUser, @Param('id', ParseUUIDPipe) id: string) { return this.alerts.remove(u.id, id); }
}
