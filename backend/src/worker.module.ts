import { NotificationsModule } from './notifications/notifications.module.js';
import { Module } from '@nestjs/common';
import { MarketJobsModule } from './jobs/jobs.module.js';
import { PortfolioAnalyticsModule } from './portfolio-analytics/portfolio-analytics.module.js';
import { AlertsModule } from './alerts/alerts.module.js';
@Module({
  imports: [
    MarketJobsModule,
    PortfolioAnalyticsModule,
    AlertsModule,
    NotificationsModule,
  ],
})
export class WorkerModule {}
