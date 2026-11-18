import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { UsersModule } from '../users/users.module.js';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { PriceAlertsService } from './alerts.service.js';
import { WatchlistsService } from './watchlists.service.js';
import { PriceAlertsController, WatchlistsController } from './alerts.controller.js';
@Module({ imports: [PrismaModule, UsersModule, MarketDataModule], providers: [PriceAlertsService, WatchlistsService, SessionAuthGuard],
  controllers: [PriceAlertsController, WatchlistsController], exports: [PriceAlertsService] })
export class AlertsModule {}
