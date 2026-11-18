import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, Max, Min } from 'class-validator';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { RegisteredUser } from '../users/users.service.js';
import { TelegramLinkService } from './telegram-link.service.js';
import { NotificationsService } from './notifications.service.js';
class SettingsDto {
  @IsInt() @Min(0) @Max(1439) quietStart: number;
  @IsInt() @Min(0) @Max(1439) quietEnd: number;
  @IsIn(['Europe/Warsaw', 'America/New_York', 'UTC']) timeZone: string;
  @IsBoolean() dailySummaryEnabled: boolean;
}
class HistoryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
}
class RetryDto {
  @IsBoolean() acknowledgeDuplicateRisk = false;
}
@Controller('notifications')
@UseGuards(SessionAuthGuard)
export class NotificationsController {
  constructor(
    private readonly links: TelegramLinkService,
    private readonly notifications: NotificationsService,
  ) {}
  @Get('telegram') @Header('Cache-Control', 'no-store') status(
    @CurrentUser() user: RegisteredUser,
  ) {
    return this.links.status(user.id);
  }
  @Post('telegram/pairing') @Header('Cache-Control', 'no-store') pair(
    @CurrentUser() user: RegisteredUser,
  ) {
    return this.links.pair(user.id);
  }
  @Delete('telegram') @HttpCode(204) disconnect(
    @CurrentUser() user: RegisteredUser,
  ) {
    return this.links.disconnect(user.id);
  }
  @Patch('telegram') settings(
    @CurrentUser() user: RegisteredUser,
    @Body() body: SettingsDto,
  ) {
    return this.links.settings(user.id, body);
  }
  @Get() @Header('Cache-Control', 'no-store') history(
    @CurrentUser() user: RegisteredUser,
    @Query() query: HistoryDto,
  ) {
    return this.notifications.history(user.id, query.page);
  }
  @Post(':id/retry') retry(
    @CurrentUser() user: RegisteredUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RetryDto,
  ) {
    return this.notifications.retry(user.id, id, body.acknowledgeDuplicateRisk);
  }
}
@Controller('integrations/telegram')
export class TelegramWebhookController {
  constructor(private readonly links: TelegramLinkService) {}
  @Post() @HttpCode(200) webhook(
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() body: unknown,
  ) {
    this.links.verifySecret(secret);
    return this.links.consume(body);
  }
}
