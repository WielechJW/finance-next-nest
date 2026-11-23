import { createHash } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { InvestmentAccountsService } from '../investments/accounts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { parseImportCsv, type ImportFormat } from './import-parser.js';

const summary = {
  id: true,
  authorId: true,
  format: true,
  status: true,
  encoding: true,
  separator: true,
  createdAt: true,
  _count: { select: { rows: true } },
} satisfies Prisma.ImportBatchSelect;
const detail = {
  ...summary,
  rows: {
    select: { number: true, data: true, error: true },
    orderBy: { number: 'asc' },
  },
} satisfies Prisma.ImportBatchSelect;

@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: InvestmentAccountsService,
  ) {}

  async create(
    userId: string,
    portfolioId: string,
    accountId: string,
    format: ImportFormat,
    buffer: Buffer,
  ) {
    const account = await this.accounts.getAccount(
      userId,
      portfolioId,
      accountId,
    );
    if (account.archivedAt)
      throw new ConflictException('Rachunek jest zarchiwizowany.');
    const key = {
      accountId,
      authorId: userId,
      format,
      contentHash: createHash('sha256').update(buffer).digest('hex'),
    };
    const where = { accountId_authorId_format_contentHash: key };
    const existing = await this.prisma.importBatch.findUnique({
      where,
      select: detail,
    });
    if (existing) return existing;
    const { encoding, separator, rows } = parseImportCsv(buffer, format);
    try {
      return await this.prisma.importBatch.create({
        data: {
          ...key,
          encoding,
          separator,
          status: rows.some((row) => row.error) ? 'INVALID' : 'PARSED',
          rows: {
            createMany: {
              data: rows.map(({ number, data, error }) => ({
                number,
                data: data ?? Prisma.DbNull,
                error,
              })),
            },
          },
        },
        select: detail,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const retry = await this.prisma.importBatch.findUnique({
          where,
          select: detail,
        });
        if (retry) return retry;
      }
      throw error;
    }
  }

  async list(userId: string, portfolioId: string, accountId: string) {
    await this.accounts.getAccount(userId, portfolioId, accountId);
    return this.prisma.importBatch.findMany({
      where: { accountId, authorId: userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 30,
      select: summary,
    });
  }

  async get(
    userId: string,
    portfolioId: string,
    accountId: string,
    id: string,
  ) {
    const row = await this.prisma.importBatch.findFirst({
      where: {
        id,
        accountId,
        authorId: userId,
        account: { portfolioId, portfolio: { userId } },
      },
      select: detail,
    });
    if (!row) throw new NotFoundException('Nie znaleziono partii importu.');
    return row;
  }
}
