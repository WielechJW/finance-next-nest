import { Module } from '@nestjs/common';
import { MarketJobsModule } from './jobs/jobs.module.js';
import { PortfolioAnalyticsModule } from './portfolio-analytics/portfolio-analytics.module.js';
@Module({ imports: [MarketJobsModule, PortfolioAnalyticsModule] })
export class WorkerModule {}
