import { Module } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { UsersModule } from '../users/users.module.js';
import { InvestmentsModule } from '../investments/investments.module.js';
import { ImportsController } from './imports.controller.js';
import { ImportPreviewService } from './import-preview.service.js';
import { ImportsService } from './imports.service.js';

@Module({
  imports: [UsersModule, InvestmentsModule],
  controllers: [ImportsController],
  providers: [ImportsService, ImportPreviewService, SessionAuthGuard],
})
export class ImportsModule {}
