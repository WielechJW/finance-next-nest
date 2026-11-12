import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { formatMoney } from '../wallets/money.js';
import type { CreateTransactionDto } from './dto/create-transaction.dto.js';
import {
  MAX_TRANSACTION_OFFSET,
  type ListTransactionsDto,
} from './dto/list-transactions.dto.js';
import type {
  TransactionListResponse,
  TransactionResponse,
} from './transaction-response.js';

const transactionSelect = {
  id: true,
  walletId: true,
  type: true,
  amount: true,
  categoryId: true,
  title: true,
  note: true,
  occurredOn: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TransactionSelect;

type TransactionRecord = Prisma.TransactionGetPayload<{
  select: typeof transactionSelect;
}>;

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listForUser(
    userId: string,
    input: ListTransactionsDto,
  ): Promise<TransactionListResponse> {
    if (input.from && input.to && input.from > input.to) {
      throw new BadRequestException(
        'Data od nie może być późniejsza niż data do.',
      );
    }
    const skip = (input.page - 1) * input.pageSize;
    if (skip > MAX_TRANSACTION_OFFSET) {
      throw new BadRequestException('Wybrana strona jest zbyt odległa.');
    }

    const where: Prisma.TransactionWhereInput = { wallet: { userId } };
    if (input.type !== undefined) where.type = input.type;
    if (input.categoryId !== undefined) where.categoryId = input.categoryId;
    if (input.from !== undefined || input.to !== undefined) {
      where.occurredOn = {
        ...(input.from !== undefined
          ? { gte: new Date(input.from + 'T00:00:00.000Z') }
          : {}),
        ...(input.to !== undefined
          ? { lte: new Date(input.to + 'T00:00:00.000Z') }
          : {}),
      };
    }

    try {
      // RepeatableRead keeps the rows and their total on the same snapshot,
      // even when another request inserts or removes an operation in between.
      const [transactions, total] = await this.prisma.$transaction(
        [
          this.prisma.transaction.findMany({
            where,
            orderBy: [{ occurredOn: 'desc' }, { id: 'desc' }],
            skip,
            take: input.pageSize,
            select: transactionSelect,
          }),
          this.prisma.transaction.count({ where }),
        ],
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );

      return {
        items: transactions.map((transaction) => this.toResponse(transaction)),
        page: input.page,
        pageSize: input.pageSize,
        total,
      };
    } catch {
      this.logger.error('Nie udało się odczytać historii transakcji.');
      throw new InternalServerErrorException(
        'Nie udało się pobrać historii transakcji.',
      );
    }
  }

  async getForUser(userId: string, id: string): Promise<TransactionResponse> {
    try {
      const transaction = await this.prisma.transaction.findFirst({
        where: { id, wallet: { userId } },
        select: transactionSelect,
      });
      if (!transaction)
        throw new NotFoundException('Nie znaleziono transakcji.');
      return this.toResponse(transaction);
    } catch (error: unknown) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Nie udało się odczytać transakcji.');
      throw new InternalServerErrorException(
        'Nie udało się pobrać transakcji.',
      );
    }
  }

  async createForUser(
    userId: string,
    input: CreateTransactionDto,
  ): Promise<TransactionResponse> {
    try {
      const wallet = await this.prisma.wallet.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (!wallet) throw new NotFoundException('Nie znaleziono portfela.');

      const category = await this.prisma.category.findUnique({
        where: { id: input.categoryId },
        select: { type: true },
      });
      if (!category || category.type !== input.type) {
        throw new BadRequestException(
          'Wybierz istniejącą kategorię zgodną z typem transakcji.',
        );
      }

      const transaction = await this.prisma.transaction.create({
        data: {
          walletId: wallet.id,
          type: input.type,
          amount: new Prisma.Decimal(input.amount),
          categoryId: input.categoryId,
          title: input.title,
          note: input.note ?? null,
          occurredOn: new Date(input.occurredOn + 'T00:00:00.000Z'),
        },
        select: transactionSelect,
      });

      return this.toResponse(transaction);
    } catch (error: unknown) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      // Foreign keys still protect the write if a reference changes after lookup.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Portfel lub kategoria nie są już dostępne.',
        );
      }

      this.logger.error('Nie udało się zapisać transakcji.');
      throw new InternalServerErrorException(
        'Nie udało się zapisać transakcji.',
      );
    }
  }

  private toResponse(transaction: TransactionRecord): TransactionResponse {
    return {
      ...transaction,
      amount: formatMoney(transaction.amount),
      occurredOn: transaction.occurredOn.toISOString().slice(0, 10),
      createdAt: transaction.createdAt.toISOString(),
      updatedAt: transaction.updatedAt.toISOString(),
    };
  }
}
