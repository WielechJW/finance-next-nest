import { Module } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { UsersModule } from '../users/users.module.js';
import { InvestmentAccountsController } from './accounts.controller.js';
import { InvestmentAccountsService } from './accounts.service.js';
import { InvestmentPostingService } from './posting.service.js';
import { InvestmentEventsController, InvestmentInstrumentsController } from './events.controller.js';
import { InvestmentEventsService } from './events.service.js';

@Module({
  imports: [UsersModule],
  controllers: [InvestmentAccountsController, InvestmentEventsController, InvestmentInstrumentsController],
  providers: [InvestmentAccountsService, InvestmentPostingService, InvestmentEventsService, SessionAuthGuard],
  exports: [InvestmentAccountsService, InvestmentPostingService],
})
export class InvestmentsModule {}
