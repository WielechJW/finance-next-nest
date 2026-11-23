import { Module } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { UsersModule } from '../users/users.module.js';
import { FinancialReportsController } from './financial-reports.controller.js';
import { FinancialReportsService } from './financial-reports.service.js';
import { FundamentalAnalysisController } from './fundamental-analysis.controller.js';
import { FundamentalAnalysisService } from './fundamental-analysis.service.js';

@Module({
  imports: [UsersModule, MarketDataModule],
  controllers: [FundamentalAnalysisController, FinancialReportsController],
  providers: [FundamentalAnalysisService, FinancialReportsService, SessionAuthGuard],
})
export class FundamentalAnalysisModule {}
