import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { UsersModule } from '../users/users.module.js';
import { InvestmentsModule } from '../investments/investments.module.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { PortfolioValuationService } from './valuation.service.js';
import { PortfolioValuationController } from './valuation.controller.js';
import { CorporateActionsService } from './corporate-actions.service.js';
import { CorporateActionsController } from './corporate-actions.controller.js';

@Module({ imports: [PrismaModule, UsersModule, InvestmentsModule], providers: [PortfolioValuationService, CorporateActionsService, SessionAuthGuard],
  controllers: [PortfolioValuationController, CorporateActionsController], exports: [PortfolioValuationService] })
export class PortfolioAnalyticsModule {}
