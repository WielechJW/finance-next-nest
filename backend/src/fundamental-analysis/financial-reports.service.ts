import { createHash } from 'node:crypto';
import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  FinancialReportCurrency,
  FinancialReportPeriod,
  FinancialReportScope,
  Prisma,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { parseReport, type ParsedReport } from './report-text.js';

export type ReportImport = {
  instrumentId: string;
  scope: FinancialReportScope;
  periodKind: FinancialReportPeriod;
  currency: FinancialReportCurrency;
  periodStart: string;
  periodEnd: string;
  publishedOn: string;
  sourceUrl: string;
  filename: string;
};

const PAGE_SIZE = 20;
const METRIC_KEYS = {
  revenue: 'REVENUE',
  ebit: 'EBIT',
  netIncome: 'NET_INCOME',
  operatingCashFlow: 'OPERATING_CASH_FLOW',
  longTermDebt: 'LONG_TERM_DEBT',
} as const;

const select = {
  id: true,
  filename: true,
  scope: true,
  periodKind: true,
  currency: true,
  periodStart: true,
  periodEnd: true,
  publishedOn: true,
  sourceUrl: true,
  version: true,
  company: { select: { id: true, name: true } },
  instrument: { select: { id: true, ticker: true, mic: true, currency: true } },
  facts: {
    select: {
      metric: true,
      amount: true,
      unit: true,
      period: true,
      page: true,
    },
    orderBy: { metric: 'asc' },
  },
} satisfies Prisma.FinancialReportSelect;

type SelectedReport = Prisma.FinancialReportGetPayload<{
  select: typeof select;
}>;

function serialize(report: SelectedReport) {
  return {
    ...report,
    periodStart: report.periodStart.toISOString().slice(0, 10),
    periodEnd: report.periodEnd.toISOString().slice(0, 10),
    publishedOn: report.publishedOn.toISOString().slice(0, 10),
    facts: report.facts.map((fact) => ({
      ...fact,
      amount: fact.amount.toFixed(),
    })),
  };
}

function normalizeFacts(
  document: ParsedReport,
  input: ReportImport,
): ParsedReport {
  return {
    ...document,
    summary: document.summary.map((fact) => {
      if (fact.state !== 'verified') return fact;
      const currency = fact.unit.endsWith(' $') ? 'USD' : fact.unit.slice(-3);
      if (
        currency !== input.currency ||
        fact.scope.toUpperCase() !== input.scope ||
        !/^-?\d{1,28}(?:\.\d{1,10})?$/.test(fact.amount)
      ) {
        return { metric: fact.metric, state: 'needs_review' };
      }
      return fact;
    }),
  };
}

@Injectable()
export class FinancialReportsService {
  private readonly logger = new Logger(FinancialReportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, page: number) {
    const rows = await this.prisma.financialReport.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE + 1,
      select,
    });
    return {
      items: rows.slice(0, PAGE_SIZE).map(serialize),
      hasNext: rows.length > PAGE_SIZE,
    };
  }

  async import(
    userId: string,
    input: ReportImport,
    pdf: Buffer,
    signal: AbortSignal,
  ) {
    if (
      input.periodStart > input.periodEnd ||
      input.periodEnd > input.publishedOn
    ) {
      throw new BadRequestException(
        'Podaj poprawną kolejność początku, końca i daty publikacji raportu.',
      );
    }
    const filename = input.filename.trim();
    if (!filename) throw new BadRequestException('Podaj nazwę raportu.');

    const parsedReport = normalizeFacts(await parseReport(pdf, signal), input);
    const contentHash = createHash('sha256').update(pdf).digest('hex');
    const facts = parsedReport.summary.flatMap((fact) =>
      fact.state === 'verified'
        ? [
            {
              metric: METRIC_KEYS[fact.metric],
              amount: fact.amount,
              unit: fact.unit,
              period: fact.period,
              page: fact.page,
            },
          ]
        : [],
    );

    const report = await this.prisma
      .$transaction(async (tx) => {
        // Serializes company creation and report version allocation for this instrument.
        const [instrument] = await tx.$queryRaw<
          {
            id: string;
            name: string | null;
            ticker: string;
            companyId: string | null;
          }[]
        >`
        SELECT "id", "name", "ticker", "companyId"
        FROM "Instrument"
        WHERE "id" = ${input.instrumentId}::uuid
        FOR UPDATE
      `;
        if (!instrument)
          throw new NotFoundException('Nie znaleziono instrumentu.');
        let companyId = instrument.companyId;
        if (!companyId) {
          const company = await tx.company.create({
            data: { name: instrument.name ?? instrument.ticker },
          });
          companyId = company.id;
          await tx.instrument.update({
            where: { id: instrument.id },
            data: { companyId },
          });
        }
        await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${companyId}::uuid FOR UPDATE`;
        const group = {
          userId,
          companyId,
          scope: input.scope,
          periodKind: input.periodKind,
          periodStart: new Date(input.periodStart),
          periodEnd: new Date(input.periodEnd),
        };
        const duplicate = await tx.financialReport.findFirst({
          where: { ...group, contentHash },
          select,
        });
        if (duplicate) return duplicate;
        const latest = await tx.financialReport.aggregate({
          where: group,
          _max: { version: true },
        });
        return tx.financialReport.create({
          data: {
            ...group,
            instrumentId: instrument.id,
            currency: input.currency,
            publishedOn: new Date(input.publishedOn),
            sourceUrl: input.sourceUrl,
            filename,
            version: (latest._max.version ?? 0) + 1,
            pdf: new Uint8Array(pdf),
            contentHash,
            parsedReport,
            facts: { create: facts },
          },
          select,
        });
      })
      .catch((error: unknown) => {
        if (error instanceof HttpException) throw error;
        this.logger.error('Nie udało się zapisać raportu finansowego.');
        throw new InternalServerErrorException(
          'Nie udało się zapisać raportu.',
        );
      });
    return serialize(report);
  }

  async pdf(userId: string, id: string) {
    const report = await this.prisma.financialReport.findFirst({
      where: { id, userId },
      select: { pdf: true },
    });
    if (!report) throw new NotFoundException('Nie znaleziono raportu.');
    return report;
  }

  async forAnalysis(userId: string, id: string) {
    const report = await this.prisma.financialReport.findFirst({
      where: { id, userId },
      select: { instrumentId: true, parsedReport: true },
    });
    if (!report) throw new NotFoundException('Nie znaleziono raportu.');
    return {
      instrumentId: report.instrumentId,
      document: report.parsedReport as ParsedReport,
    };
  }

  async remove(userId: string, id: string) {
    const result = await this.prisma.financialReport.deleteMany({
      where: { id, userId },
    });
    if (!result.count) throw new NotFoundException('Nie znaleziono raportu.');
  }
}
