import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { FinancialReportScope } from '../generated/prisma/client.js';
import { InvestmentCalculation as D } from '../investments/precision.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { calculateCompanyIndicators } from './company-indicators.js';

type Note = { thesis: string; risks: string; reviewConditions: string };
type Filter = {
  scope: FinancialReportScope;
  minOperatingMargin?: string;
  minNetMargin?: string;
  missing: 'include' | 'exclude' | 'only';
};

const instrumentSelect = { id: true, ticker: true, mic: true, name: true };
const noteSelect = {
  thesis: true,
  risks: true,
  reviewConditions: true,
  updatedAt: true,
};
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

@Injectable()
export class ResearchService {
  constructor(private readonly prisma: PrismaService) {}

  note(userId: string, instrumentId: string) {
    return this.prisma.investmentNote.findUnique({
      where: { userId_instrumentId: { userId, instrumentId } },
      select: noteSelect,
    });
  }

  async saveNote(userId: string, instrumentId: string, input: Note) {
    const note = {
      thesis: input.thesis.trim(),
      risks: input.risks.trim(),
      reviewConditions: input.reviewConditions.trim(),
    };
    if (!note.thesis && !note.risks && !note.reviewConditions)
      throw new BadRequestException(
        'Uzupełnij przynajmniej jedno pole notatki.',
      );
    const instrument = await this.prisma.instrument.findUnique({
      where: { id: instrumentId },
      select: { id: true },
    });
    if (!instrument) throw new NotFoundException('Nie znaleziono instrumentu.');
    return this.prisma.investmentNote.upsert({
      where: { userId_instrumentId: { userId, instrumentId } },
      create: { userId, instrumentId, ...note },
      update: note,
      select: noteSelect,
    });
  }

  async deleteNote(userId: string, instrumentId: string) {
    await this.prisma.investmentNote.deleteMany({
      where: { userId, instrumentId },
    });
  }

  async screen(userId: string, filter: Filter) {
    const [instruments, reports] = await Promise.all([
      this.prisma.instrument.findMany({
        where: { financialReports: { some: { userId } } },
        select: instrumentSelect,
        orderBy: [{ ticker: 'asc' }, { mic: 'asc' }],
      }),
      this.prisma.financialReport.findMany({
        where: { userId, scope: filter.scope, periodKind: 'ANNUAL' },
        distinct: ['instrumentId'],
        orderBy: [
          { periodEnd: 'desc' },
          { publishedOn: 'desc' },
          { version: 'desc' },
        ],
        select: {
          id: true,
          instrumentId: true,
          periodStart: true,
          periodEnd: true,
          periodKind: true,
          publishedOn: true,
          currency: true,
          facts: {
            where: { metric: { in: ['REVENUE', 'EBIT', 'NET_INCOME'] } },
            select: { metric: true, amount: true, unit: true, page: true },
          },
        },
      }),
    ]);
    const latest = new Map(
      reports.map((report) => [report.instrumentId, report]),
    );
    const rows = instruments.map((instrument) => {
      const saved = latest.get(instrument.id);
      if (!saved)
        return {
          instrument,
          report: null,
          operatingMargin: null,
          netMargin: null,
        };
      const report = {
        ...saved,
        periodStart: isoDay(saved.periodStart),
        periodEnd: isoDay(saved.periodEnd),
        publishedOn: isoDay(saved.publishedOn),
        facts: saved.facts.map((fact) => ({
          ...fact,
          amount: fact.amount.toFixed(),
        })),
      };
      const ratios = calculateCompanyIndicators(
        report,
        [],
        { status: 'missing', price: null },
        [],
      );
      return {
        instrument,
        report,
        operatingMargin: ratios.operatingMargin.value,
        netMargin: ratios.netMargin.value,
      };
    });
    return rows.filter(({ operatingMargin, netMargin }) => {
      const missing = operatingMargin === null || netMargin === null;
      if (
        (filter.missing === 'only' && !missing) ||
        (filter.missing === 'exclude' && missing)
      )
        return false;
      if (
        filter.minOperatingMargin !== undefined &&
        operatingMargin !== null &&
        new D(operatingMargin).lt(filter.minOperatingMargin)
      )
        return false;
      return (
        filter.minNetMargin === undefined ||
        netMargin === null ||
        new D(netMargin).gte(filter.minNetMargin)
      );
    });
  }
}
