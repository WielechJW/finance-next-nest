import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Currency, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { formatMoney } from '../wallets/money.js';
import { resolveAnalyticsPeriod } from './analytics-period.js';
import type { AnalyticsSummaryResponse } from './analytics-response.js';
import type { AnalyticsPeriodDto } from './dto/analytics-period.dto.js';

interface SummaryRecord {
  currency: Currency;
  income: Prisma.Decimal;
  expenses: Prisma.Decimal;
  periodResult: Prisma.Decimal;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async summaryForUser(
    userId: string,
    input: AnalyticsPeriodDto,
  ): Promise<AnalyticsSummaryResponse> {
    const period = resolveAnalyticsPeriod(input);
    let summary: SummaryRecord | undefined;
    try {
      // One statement keeps both totals and their difference on one snapshot.
      // PostgreSQL numeric preserves precision even beyond individual amounts.
      [summary] = await this.prisma.$queryRaw<SummaryRecord[]>`
        WITH totals AS (
          SELECT w."currency",
            COALESCE(SUM(t."amount") FILTER (WHERE t."type" = 'INCOME'), 0) AS "income",
            COALESCE(SUM(t."amount") FILTER (WHERE t."type" = 'EXPENSE'), 0) AS "expenses"
          FROM "Wallet" w
          LEFT JOIN "Transaction" t ON t."walletId" = w."id"
            AND t."occurredOn" >= ${period.from}::date
            AND t."occurredOn" <= ${period.to}::date
          WHERE w."userId" = ${userId}::uuid
          GROUP BY w."id"
        )
        SELECT "currency", "income", "expenses",
          "income" - "expenses" AS "periodResult"
        FROM totals
      `;
    } catch {
      this.logger.error('Nie udało się odczytać podsumowania analityki.');
      throw new InternalServerErrorException(
        'Nie udało się pobrać podsumowania analityki.',
      );
    }

    if (!summary) throw new NotFoundException('Nie znaleziono portfela.');
    return {
      ...period,
      currency: summary.currency,
      income: formatMoney(summary.income),
      expenses: formatMoney(summary.expenses),
      periodResult: formatMoney(summary.periodResult),
    };
  }
}
