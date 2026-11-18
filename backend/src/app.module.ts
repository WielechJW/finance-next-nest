import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { SessionModule } from './sessions/session.module.js';
import { WalletsModule } from './wallets/wallets.module.js';
import { CategoriesModule } from './categories/categories.module.js';
import { TransactionsModule } from './transactions/transactions.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { InvestmentsModule } from './investments/investments.module.js';
import { MarketDataModule } from './market-data/market-data.module.js';
import { PortfolioAnalyticsModule } from './portfolio-analytics/portfolio-analytics.module.js';
import { AlertsModule } from './alerts/alerts.module.js';

@Module({
  imports: [
    PrismaModule,
    SessionModule,
    AuthModule,
    WalletsModule,
    CategoriesModule,
    TransactionsModule,
    AnalyticsModule,
    InvestmentsModule,
    MarketDataModule,
    PortfolioAnalyticsModule,
    AlertsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
