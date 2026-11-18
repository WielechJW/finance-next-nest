import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { UsersModule } from '../users/users.module.js';
import { PortfolioAnalyticsModule } from '../portfolio-analytics/portfolio-analytics.module.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { TelegramClient } from './telegram.client.js';
import { TelegramLinkService } from './telegram-link.service.js';
import { NotificationsService } from './notifications.service.js';
import {
  NotificationsController,
  TelegramWebhookController,
} from './notifications.controller.js';
@Module({
  imports: [PrismaModule, UsersModule, PortfolioAnalyticsModule],
  providers: [
    TelegramClient,
    TelegramLinkService,
    NotificationsService,
    SessionAuthGuard,
  ],
  controllers: [NotificationsController, TelegramWebhookController],
  exports: [TelegramClient, NotificationsService],
})
export class NotificationsModule {}
