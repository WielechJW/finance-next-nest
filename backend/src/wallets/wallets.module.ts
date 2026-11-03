import { Module } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { UsersModule } from '../users/users.module.js';
import { WalletsController } from './wallets.controller.js';
import { WalletsService } from './wallets.service.js';

@Module({
  imports: [UsersModule],
  controllers: [WalletsController],
  providers: [WalletsService, SessionAuthGuard],
})
export class WalletsModule {}
