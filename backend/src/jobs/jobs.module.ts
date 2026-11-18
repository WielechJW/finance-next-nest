import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { MarketJobsService } from './jobs.service.js';
import { MarketSchedulerService } from './scheduler.service.js';

@Module({ imports: [PrismaModule, MarketDataModule], providers: [MarketJobsService, MarketSchedulerService], exports: [MarketJobsService, MarketSchedulerService] })
export class MarketJobsModule {}
