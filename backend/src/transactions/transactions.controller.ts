import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
import { UpdateTransactionDto } from './dto/update-transaction.dto.js';
import type {
  TransactionListResponse,
  TransactionResponse,
} from './transaction-response.js';
import { TransactionsService } from './transactions.service.js';

const transactionIdPipe = new ParseUUIDPipe({
  exceptionFactory: () =>
    new BadRequestException('Podaj poprawny identyfikator UUID transakcji.'),
});

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
    @Param('id', transactionIdPipe)
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

  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  update(
    @CurrentUser() user: RegisteredUser,
    @Param('id', transactionIdPipe) id: string,
    @Body() input: UpdateTransactionDto,
  ): Promise<TransactionResponse> {
    return this.transactions.updateForUser(user.id, id, input);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  remove(
    @CurrentUser() user: RegisteredUser,
    @Param('id', transactionIdPipe) id: string,
  ): Promise<void> {
    return this.transactions.deleteForUser(user.id, id);
  }
}
