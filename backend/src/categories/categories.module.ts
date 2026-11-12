import { Module } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { UsersModule } from '../users/users.module.js';
import { CategoriesController } from './categories.controller.js';
import { CategoriesService } from './categories.service.js';

@Module({
  imports: [UsersModule],
  controllers: [CategoriesController],
  providers: [CategoriesService, SessionAuthGuard],
})
export class CategoriesModule {}
