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
import type {
  AnalyticsCategoriesResponse,
  AnalyticsSummaryResponse,
  AnalyticsTrendsResponse,
} from './analytics-response.js';
import { resolveAnalyticsTrends } from './analytics-trends.js';
import type { AnalyticsPeriodDto } from './dto/analytics-period.dto.js';
import type { AnalyticsTrendsDto } from './dto/analytics-trends.dto.js';

interface SummaryRecord {
  currency: Currency;
  income: Prisma.Decimal;
  expenses: Prisma.Decimal;
  periodResult: Prisma.Decimal;
}

interface TrendRecord extends SummaryRecord {
  period: string;
}

type CategoryRecord = {
  currency: Currency;
  totalExpenses: Prisma.Decimal;
} & (
  | {
      categoryId: string;
      categoryName: string;
      amount: Prisma.Decimal;
      percentage: Prisma.Decimal;
    }
  | {
      // The left join retains a wallet without expenses, unlike a missing one.
      categoryId: null;
      categoryName: null;
      amount: null;
      percentage: null;
    }
);

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

  async categoriesForUser(
    userId: string,
    input: AnalyticsPeriodDto,
  ): Promise<AnalyticsCategoriesResponse> {
    const period = resolveAnalyticsPeriod(input);
    let records: CategoryRecord[];
    try {
      // Group amounts, total them and round their shares on the same snapshot.
      // numeric ROUND rounds positive halfway values up, without JS floats.
      records = await this.prisma.$queryRaw<CategoryRecord[]>`
        WITH own_wallet AS (
          SELECT "id", "currency" FROM "Wallet"
          WHERE "userId" = ${userId}::uuid
        ), grouped AS (
          SELECT c."id" AS "categoryId", c."name" AS "categoryName",
            SUM(t."amount") AS "amount"
          FROM own_wallet w
          JOIN "Transaction" t ON t."walletId" = w."id"
          JOIN "Category" c ON c."id" = t."categoryId"
          WHERE t."type" = 'EXPENSE'
            AND t."occurredOn" >= ${period.from}::date
            AND t."occurredOn" <= ${period.to}::date
          GROUP BY c."id", c."name"
        ), category_totals AS (
          SELECT *, SUM("amount") OVER () AS "totalExpenses"
          FROM grouped
        )
        SELECT w."currency", g."categoryId", g."categoryName", g."amount",
          COALESCE(g."totalExpenses", 0) AS "totalExpenses",
          ROUND(g."amount" * 100 / NULLIF(g."totalExpenses", 0), 2) AS "percentage"
        FROM own_wallet w
        LEFT JOIN category_totals g ON true
        ORDER BY g."amount" DESC, g."categoryId" ASC
      `;
    } catch {
      this.logger.error('Nie udało się odczytać wydatków według kategorii.');
      throw new InternalServerErrorException(
        'Nie udało się pobrać wydatków według kategorii.',
      );
    }

    const first = records[0];
    if (!first) throw new NotFoundException('Nie znaleziono portfela.');
    return {
      ...period,
      currency: first.currency,
      totalExpenses: formatMoney(first.totalExpenses),
      items: records.flatMap((record) =>
        record.categoryId === null
          ? []
          : [
              {
                categoryId: record.categoryId,
                categoryName: record.categoryName,
                amount: formatMoney(record.amount),
                percentage: formatMoney(record.percentage),
              },
            ],
      ),
    };
  }

  async trendsForUser(
    userId: string,
    input: AnalyticsTrendsDto,
  ): Promise<AnalyticsTrendsResponse> {
    const { from, to, granularity, pointCount } = resolveAnalyticsTrends(input);
    let records: TrendRecord[];
    try {
      // Integer offsets generate only the validated number of calendar buckets.
      // Explicit timestamp WITHOUT time zone keeps month grouping independent
      // of the database's time zone. All money is aggregated in one snapshot.
      records = await this.prisma.$queryRaw<TrendRecord[]>`
        WITH own_wallet AS (
          SELECT "id", "currency" FROM "Wallet"
          WHERE "userId" = ${userId}::uuid
        ), buckets AS (
          SELECT CASE WHEN ${granularity}::text = 'day'
            THEN ${from}::date + offset_number
            ELSE (date_trunc('month', ${from}::date::timestamp) +
              make_interval(months => offset_number))::date
            END AS "bucket"
          FROM generate_series(0, ${pointCount - 1}::int) AS offsets(offset_number)
        ), grouped AS (
          SELECT CASE WHEN ${granularity}::text = 'day'
            THEN t."occurredOn"
            ELSE date_trunc('month', t."occurredOn"::timestamp)::date
            END AS "bucket",
            COALESCE(SUM(t."amount") FILTER (WHERE t."type" = 'INCOME'), 0) AS "income",
            COALESCE(SUM(t."amount") FILTER (WHERE t."type" = 'EXPENSE'), 0) AS "expenses"
          FROM own_wallet w
          JOIN "Transaction" t ON t."walletId" = w."id"
          WHERE t."occurredOn" >= ${from}::date AND t."occurredOn" <= ${to}::date
          GROUP BY 1
        )
        SELECT w."currency",
          to_char(b."bucket"::timestamp, CASE WHEN ${granularity}::text = 'day'
            THEN 'YYYY-MM-DD' ELSE 'YYYY-MM' END) AS "period",
          COALESCE(g."income", 0) AS "income",
          COALESCE(g."expenses", 0) AS "expenses",
          COALESCE(g."income", 0) - COALESCE(g."expenses", 0) AS "periodResult"
        FROM own_wallet w
        CROSS JOIN buckets b
        LEFT JOIN grouped g ON g."bucket" = b."bucket"
        ORDER BY b."bucket" ASC
      `;
    } catch {
      this.logger.error('Nie udało się odczytać trendów analityki.');
      throw new InternalServerErrorException(
        'Nie udało się pobrać trendów analityki.',
      );
    }

    const first = records[0];
    if (!first) throw new NotFoundException('Nie znaleziono portfela.');
    return {
      from,
      to,
      currency: first.currency,
      granularity,
      items: records.map((record) => ({
        period: record.period,
        income: formatMoney(record.income),
        expenses: formatMoney(record.expenses),
        periodResult: formatMoney(record.periodResult),
      })),
    };
  }
}
