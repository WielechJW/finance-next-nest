import { Module } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { UsersModule } from '../users/users.module.js';
import { FundamentalAnalysisController } from './fundamental-analysis.controller.js';
import { FundamentalAnalysisService } from './fundamental-analysis.service.js';

@Module({
  imports: [UsersModule],
  controllers: [FundamentalAnalysisController],
  providers: [FundamentalAnalysisService, SessionAuthGuard],
})
export class FundamentalAnalysisModule {}
