import { Module } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { UsersModule } from '../users/users.module.js';
import { PortfolioAnalyticsModule } from '../portfolio-analytics/portfolio-analytics.module.js';
import { InvestmentExportsController } from './investment-exports.controller.js';
import { InvestmentExportsService } from './investment-exports.service.js';
import { InvestmentsModule } from '../investments/investments.module.js';
import { ImportsController } from './imports.controller.js';
import { ImportConfirmationService } from './import-confirmation.service.js';
import { ImportPreviewService } from './import-preview.service.js';
import { ImportsService } from './imports.service.js';

@Module({
  imports: [UsersModule, InvestmentsModule, PortfolioAnalyticsModule],
  controllers: [ImportsController, InvestmentExportsController],
  providers: [
    ImportsService,
    ImportPreviewService,
    ImportConfirmationService,
    InvestmentExportsService,
    SessionAuthGuard,
  ],
})
export class ImportsModule {}
