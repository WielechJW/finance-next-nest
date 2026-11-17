import {
  BadRequestException, HttpException, Injectable, InternalServerErrorException, Logger, NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { UpdateInvestmentAccountDto } from './dto/account.dto.js';

const portfolioSelect = { id: true, name: true, createdAt: true, updatedAt: true } as const;
const accountSelect = { ...portfolioSelect, portfolioId: true, archivedAt: true } as const;

@Injectable()
export class InvestmentAccountsService {
  private readonly logger = new Logger(InvestmentAccountsService.name);
  constructor(private readonly prisma: PrismaService) {}

  // Do not include raw SQL or private names in error responses or logs.
  async safely<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('Nie znaleziono zasobu inwestycyjnego.');
      }
      this.logger.error('Nie udało się obsłużyć zasobu inwestycyjnego.');
      throw new InternalServerErrorException('Nie udało się obsłużyć zasobu inwestycyjnego.');
    }
  }

  listPortfolios(userId: string) {
    return this.safely(() => this.prisma.portfolio.findMany({
      where: { userId }, select: portfolioSelect, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }));
  }

  createPortfolio(userId: string, name: string) {
    return this.safely(() => this.prisma.portfolio.create({ data: { userId, name }, select: portfolioSelect }));
  }

  getPortfolio(userId: string, portfolioId: string) {
    return this.safely(async () => {
      const portfolio = await this.prisma.portfolio.findFirst({
        where: { id: portfolioId, userId }, select: portfolioSelect,
      });
      if (!portfolio) throw new NotFoundException('Nie znaleziono portfela inwestycyjnego.');
      return portfolio;
    });
  }

  renamePortfolio(userId: string, portfolioId: string, name: string) {
    return this.safely(() => this.prisma.portfolio.update({
      where: { id: portfolioId, userId }, data: { name }, select: portfolioSelect,
    }));
  }

  async listAccounts(userId: string, portfolioId: string) {
    return this.safely(async () => {
      await this.getPortfolio(userId, portfolioId);
      return this.prisma.investmentAccount.findMany({
        where: { portfolioId, portfolio: { userId } }, select: accountSelect,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
    });
  }

  createAccount(userId: string, portfolioId: string, name: string) {
    return this.safely(async () => {
      await this.getPortfolio(userId, portfolioId);
      return this.prisma.investmentAccount.create({ data: { portfolioId, name }, select: accountSelect });
    });
  }

  getAccount(userId: string, portfolioId: string, accountId: string) {
    return this.safely(async () => {
      const account = await this.prisma.investmentAccount.findFirst({
        where: { id: accountId, portfolioId, portfolio: { userId } }, select: accountSelect,
      });
      if (!account) throw new NotFoundException('Nie znaleziono rachunku inwestycyjnego.');
      return account;
    });
  }

  updateAccount(userId: string, portfolioId: string, accountId: string, input: UpdateInvestmentAccountDto) {
    if (input.name === undefined && input.archived === undefined) {
      throw new BadRequestException('Podaj przynajmniej jedno pole do zmiany.');
    }
    return this.safely(() => this.prisma.$transaction(async (tx) => {
      // The same account lock is used by posting/correction, so archiving cannot race a write.
      const [account] = await tx.$queryRaw<{ id: string; archivedAt: Date | null }[]>`
        SELECT a."id", a."archivedAt" FROM "InvestmentAccount" a
        JOIN "Portfolio" p ON p."id" = a."portfolioId"
        WHERE a."id" = ${accountId}::uuid AND a."portfolioId" = ${portfolioId}::uuid
          AND p."userId" = ${userId}::uuid
        FOR UPDATE OF a
      `;
      if (!account) throw new NotFoundException('Nie znaleziono rachunku inwestycyjnego.');
      return tx.investmentAccount.update({ where: { id: accountId }, data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.archived !== undefined ? { archivedAt: input.archived ? account.archivedAt ?? new Date() : null } : {}),
      }, select: accountSelect });
    }));
  }
}
