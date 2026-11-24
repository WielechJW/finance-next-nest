import { Module } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { InvestmentsModule } from '../investments/investments.module.js';
import { UsersModule } from '../users/users.module.js';
import { PaperController } from './paper.controller.js';
import { PaperExecutionService } from './paper-execution.service.js';
import { PaperService } from './paper.service.js';

@Module({
  imports: [UsersModule, InvestmentsModule],
  providers: [PaperService, PaperExecutionService, SessionAuthGuard],
  controllers: [PaperController],
  exports: [PaperService, PaperExecutionService],
})
export class PaperModule {}
