import { Body, Controller, Header, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import type { RegisteredUser } from '../users/users.service.js';
import { CreateTransactionDto } from './dto/create-transaction.dto.js';
import type { TransactionResponse } from './transaction-response.js';
import { TransactionsService } from './transactions.service.js';

@Controller('transactions')
@UseGuards(SessionAuthGuard)
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Post()
  @Header('Cache-Control', 'no-store')
  create(
    @CurrentUser() user: RegisteredUser,
    @Body() input: CreateTransactionDto,
  ): Promise<TransactionResponse> {
    return this.transactions.createForUser(user.id, input);
  }
}
