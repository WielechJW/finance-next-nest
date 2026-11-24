import { Module } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { InvestmentsModule } from '../investments/investments.module.js';
import { UsersModule } from '../users/users.module.js';
import { StrategiesController } from './strategies.controller.js';
import { StrategiesService } from './strategies.service.js';

@Module({
  imports: [UsersModule, InvestmentsModule],
  providers: [StrategiesService, SessionAuthGuard],
  controllers: [StrategiesController],
  exports: [StrategiesService],
})
export class StrategiesModule {}
