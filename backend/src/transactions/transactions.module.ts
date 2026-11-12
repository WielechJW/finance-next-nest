import { Module } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { UsersModule } from '../users/users.module.js';
import { TransactionsController } from './transactions.controller.js';
import { TransactionsService } from './transactions.service.js';

@Module({
  imports: [UsersModule],
  controllers: [TransactionsController],
  providers: [TransactionsService, SessionAuthGuard],
})
export class TransactionsModule {}
