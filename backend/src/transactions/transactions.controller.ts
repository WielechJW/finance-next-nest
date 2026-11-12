import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import type { RegisteredUser } from '../users/users.service.js';
import { CreateTransactionDto } from './dto/create-transaction.dto.js';
import { ListTransactionsDto } from './dto/list-transactions.dto.js';
import type {
  TransactionListResponse,
  TransactionResponse,
} from './transaction-response.js';
import { TransactionsService } from './transactions.service.js';

@Controller('transactions')
@UseGuards(SessionAuthGuard)
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentUser() user: RegisteredUser,
    @Query() input: ListTransactionsDto,
  ): Promise<TransactionListResponse> {
    return this.transactions.listForUser(user.id, input);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  get(
    @CurrentUser() user: RegisteredUser,
    @Param(
      'id',
      new ParseUUIDPipe({
        exceptionFactory: () =>
          new BadRequestException(
            'Podaj poprawny identyfikator UUID transakcji.',
          ),
      }),
    )
    id: string,
  ): Promise<TransactionResponse> {
    return this.transactions.getForUser(user.id, id);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  create(
    @CurrentUser() user: RegisteredUser,
    @Body() input: CreateTransactionDto,
  ): Promise<TransactionResponse> {
    return this.transactions.createForUser(user.id, input);
  }
}
