import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { UsersModule } from '../users/users.module.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { OperationsService } from './operations.service.js';
import {
  HealthController,
  OperationsController,
} from './operations.controller.js';
@Module({
  imports: [PrismaModule, UsersModule],
  providers: [SessionAuthGuard, OperationsService],
  controllers: [HealthController, OperationsController],
})
export class OperationsModule {}
