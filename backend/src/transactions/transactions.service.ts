import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type TransactionType } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { formatMoney } from '../wallets/money.js';
import type { CreateTransactionDto } from './dto/create-transaction.dto.js';
import type { UpdateTransactionDto } from './dto/update-transaction.dto.js';
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

      await this.assertCategory(this.prisma, input.type, input.categoryId);

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

  async updateForUser(
    userId: string,
    id: string,
    input: UpdateTransactionDto,
  ): Promise<TransactionResponse> {
    if (
      [
        input.type,
        input.amount,
        input.categoryId,
        input.title,
        input.occurredOn,
        input.note,
      ].every((value) => value === undefined)
    ) {
      throw new BadRequestException('Podaj przynajmniej jedno pole do zmiany.');
    }

    try {
      return await this.prisma.$transaction(
        async (database) => {
          // Serialize edits before deriving the final type/category pair. Only
          // the owned transaction is locked; unrelated records remain available.
          const [current] = await database.$queryRaw<
            Pick<TransactionRecord, 'id' | 'type' | 'categoryId'>[]
          >`
          SELECT t."id", t."type", t."categoryId"
          FROM "Transaction" t
          JOIN "Wallet" w ON w."id" = t."walletId"
          WHERE t."id" = ${id}::uuid AND w."userId" = ${userId}::uuid
          FOR UPDATE OF t
        `;
          if (!current)
            throw new NotFoundException('Nie znaleziono transakcji.');

          await this.assertCategory(
            database,
            input.type ?? current.type,
            input.categoryId ?? current.categoryId,
          );
          // Copy only editable fields; identifiers and ownership never come from DTO.
          const data: Prisma.TransactionUncheckedUpdateInput = {};
          if (input.type !== undefined) data.type = input.type;
          if (input.amount !== undefined)
            data.amount = new Prisma.Decimal(input.amount);
          if (input.categoryId !== undefined)
            data.categoryId = input.categoryId;
          if (input.title !== undefined) data.title = input.title;
          if (input.occurredOn !== undefined)
            data.occurredOn = new Date(input.occurredOn + 'T00:00:00.000Z');
          if (input.note !== undefined) data.note = input.note;

          const updated = await database.transaction.update({
            where: { id, wallet: { userId } },
            data,
            select: transactionSelect,
          });
          return this.toResponse(updated);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
    } catch (error: unknown) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      )
        throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025')
          throw new NotFoundException('Nie znaleziono transakcji.');
        if (error.code === 'P2003')
          throw new BadRequestException(
            'Portfel lub kategoria nie są już dostępne.',
          );
      }
      this.logger.error('Nie udało się zmienić transakcji.');
      throw new InternalServerErrorException(
        'Nie udało się zmienić transakcji.',
      );
    }
  }

  async deleteForUser(userId: string, id: string): Promise<void> {
    try {
      await this.prisma.transaction.delete({
        where: { id, wallet: { userId } },
        select: { id: true },
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Nie znaleziono transakcji.');
      }
      this.logger.error('Nie udało się usunąć transakcji.');
      throw new InternalServerErrorException(
        'Nie udało się usunąć transakcji.',
      );
    }
  }

  private async assertCategory(
    database: Pick<Prisma.TransactionClient, 'category'>,
    type: TransactionType,
    categoryId: string,
  ): Promise<void> {
    const category = await database.category.findUnique({
      where: { id: categoryId },
      select: { type: true },
    });
    if (!category || category.type !== type) {
      throw new BadRequestException(
        'Wybierz istniejącą kategorię zgodną z typem transakcji.',
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
