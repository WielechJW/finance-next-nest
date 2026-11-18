import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { UsersModule } from '../users/users.module.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { MarketDataBudgetService } from './budget.service.js';
import { EodhdProvider } from './eodhd.provider.js';
import { MarketInstrumentsController } from './instruments.controller.js';
import { MarketInstrumentsService } from './instruments.service.js';
import { MarketHistoryService } from './history.service.js';
import { MarketSyncService } from './sync.service.js';
import { MarketQualityService } from './quality.service.js';

@Module({ imports: [PrismaModule, UsersModule], controllers: [MarketInstrumentsController],
  providers: [MarketDataBudgetService, EodhdProvider, MarketInstrumentsService, MarketHistoryService, MarketSyncService, MarketQualityService, SessionAuthGuard],
  exports: [MarketDataBudgetService, EodhdProvider, MarketInstrumentsService, MarketHistoryService, MarketSyncService, MarketQualityService] })
export class MarketDataModule {}
