import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { UsersModule } from '../users/users.module.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { MarketDataBudgetService } from './budget.service.js';
import { EodhdProvider } from './eodhd.provider.js';
import { MarketInstrumentsController } from './instruments.controller.js';
import { MarketInstrumentsService } from './instruments.service.js';

@Module({ imports: [PrismaModule, UsersModule], controllers: [MarketInstrumentsController],
  providers: [MarketDataBudgetService, EodhdProvider, MarketInstrumentsService, SessionAuthGuard],
  exports: [MarketDataBudgetService, EodhdProvider, MarketInstrumentsService] })
export class MarketDataModule {}
