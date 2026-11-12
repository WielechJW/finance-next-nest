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
import type { TransactionResponse } from './transaction-response.js';

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

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(private readonly prisma: PrismaService) {}

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

      return {
        ...transaction,
        amount: formatMoney(transaction.amount),
        occurredOn: transaction.occurredOn.toISOString().slice(0, 10),
        createdAt: transaction.createdAt.toISOString(),
        updatedAt: transaction.updatedAt.toISOString(),
      };
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
}
