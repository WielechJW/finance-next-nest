import { Module } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { getAuthRateLimitOptions } from '../config/rate-limit.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { SessionAuthGuard } from './session-auth.guard.js';

@Module({
  imports: [
    UsersModule,
    ThrottlerModule.forRootAsync({
      useFactory: () => getAuthRateLimitOptions(),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, SessionAuthGuard, ThrottlerGuard],
})
export class AuthModule {}
