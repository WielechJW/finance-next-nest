import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { InvestmentAccountsService } from './accounts.service.js';
import type { CorrectInvestmentEventDto, CreateInvestmentEventDto, ListInvestmentEventsDto } from './dto/event.dto.js';
import { toInvestmentInput } from './event-input.js';
import { replayFifo } from './fifo.js';
import { InvestmentPostingService } from './posting.service.js';
import { replayBalances } from './posting.js';

const instrumentSelect = { id: true, ticker: true, mic: true, currency: true, isin: true } as const;
const eventInclude = {
  cashEntries: { orderBy: { id: 'asc' as const } },
  securityEntries: { orderBy: { id: 'asc' as const } },
  trade: { include: { instrument: { select: instrumentSelect } } },
  openingLot: { include: { instrument: { select: instrumentSelect } } },
} satisfies Prisma.InvestmentEventInclude;
type EventRecord = Prisma.InvestmentEventGetPayload<{ include: typeof eventInclude }>;

function response(event: EventRecord) {
  const date = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;
  return {
    id: event.id, accountId: event.accountId, type: event.type, source: event.source,
    occurredOn: date(event.occurredOn), timePrecision: event.timePrecision,
    executedAt: event.executedAt?.toISOString() ?? null, sourceTimeZone: event.sourceTimeZone,
    marketSessionOn: date(event.marketSessionOn), settledOn: date(event.settledOn),
    daySequence: event.daySequence, recordedAt: event.recordedAt.toISOString(),
    revision: event.revision, effective: event.activeSlot === 1,
    correctionOfId: event.correctionOfId, correctionReason: event.correctionReason,
    fxRatePlnPerUsd: event.fxRatePlnPerUsd?.toFixed(8) ?? null,
    cashEntries: event.cashEntries.map((entry) => ({ kind: entry.kind, currency: entry.currency, amount: entry.amount.toFixed(2) })),
    securityEntries: event.securityEntries.map((entry) => ({ instrumentId: entry.instrumentId, quantity: entry.quantity.toFixed(10) })),
    trade: event.trade ? { instrument: event.trade.instrument, quantity: event.trade.quantity.toFixed(10),
      unitPrice: event.trade.unitPrice.toFixed(10), grossAmount: event.trade.grossAmount.toFixed(2) } : null,
    openingLot: event.openingLot ? { instrument: event.openingLot.instrument, quantity: event.openingLot.quantity.toFixed(10),
      totalCost: event.openingLot.totalCost.toFixed(8), acquiredOn: date(event.openingLot.acquiredOn) } : null,
  };
}

@Injectable()
export class InvestmentEventsService {
  constructor(private readonly prisma: PrismaService, private readonly accounts: InvestmentAccountsService,
    private readonly posting: InvestmentPostingService) {}

  async post(userId: string, portfolioId: string, accountId: string, input: CreateInvestmentEventDto) {
    await this.accounts.getAccount(userId, portfolioId, accountId);
    return this.accounts.safely(async () => {
      const result = await this.posting.postForUser(userId, toInvestmentInput(accountId, input));
      // Identical acknowledgement for an initial write and a network retry.
      return { eventId: result.eventId, revision: 0 };
    });
  }

  async correct(userId: string, portfolioId: string, accountId: string, eventId: string, input: CorrectInvestmentEventDto) {
    await this.accounts.getAccount(userId, portfolioId, accountId);
    return this.accounts.safely(async () => {
      const result = await this.posting.correctForUser(userId, {
        accountId, targetEventId: eventId, expectedRevision: input.expectedRevision,
        reason: input.reason, idempotencyKey: input.idempotencyKey,
        replacement: input.replacement === null ? null : toInvestmentInput(accountId, input.replacement),
      });
      return { eventId: result.eventId, revision: result.revision };
    });
  }

  async get(userId: string, portfolioId: string, accountId: string, eventId: string) {
    return this.accounts.safely(async () => {
      const event = await this.prisma.investmentEvent.findFirst({ where: {
        id: eventId, accountId, account: { portfolioId, portfolio: { userId } },
      }, include: eventInclude });
      if (!event) throw new NotFoundException('Nie znaleziono operacji inwestycyjnej.');
      return response(event);
    });
  }

  async list(userId: string, portfolioId: string, accountId: string, input: ListInvestmentEventsDto) {
    await this.accounts.getAccount(userId, portfolioId, accountId);
    const skip = (input.page - 1) * input.pageSize;
    if (skip > 2147483647 || (input.from && input.to && input.from > input.to)) {
      throw new BadRequestException('Niepoprawny zakres dat lub zbyt odległa strona.');
    }
    const where: Prisma.InvestmentEventWhereInput = {
      accountId, account: { portfolioId, portfolio: { userId } },
      ...(input.view === 'effective' ? { activeSlot: 1 } : {}),
      ...(input.type ? { type: input.type } : {}),
      ...(input.instrumentId ? { securityEntries: { some: { instrumentId: input.instrumentId } } } : {}),
      ...(input.from || input.to ? { occurredOn: {
        ...(input.from ? { gte: new Date(`${input.from}T00:00:00.000Z`) } : {}),
        ...(input.to ? { lte: new Date(`${input.to}T00:00:00.000Z`) } : {}),
      } } : {}),
    };
    return this.accounts.safely(async () => {
      const [events, total] = await this.prisma.$transaction([
        this.prisma.investmentEvent.findMany({ where, include: eventInclude, skip, take: input.pageSize,
          orderBy: [{ occurredOn: 'desc' }, { daySequence: 'desc' }, { recordedAt: 'desc' }, { id: 'desc' }] }),
        this.prisma.investmentEvent.count({ where }),
      ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      return { items: events.map(response), total, page: input.page, pageSize: input.pageSize };
    });
  }

  async summary(userId: string, portfolioId: string, accountId: string) {
    return this.accounts.safely(() => this.prisma.$transaction(async (tx) => {
      const account = await tx.investmentAccount.findFirst({ where: {
        id: accountId, portfolioId, portfolio: { userId },
      }, select: { id: true } });
      if (!account) throw new NotFoundException('Nie znaleziono rachunku inwestycyjnego.');
      const events = await tx.investmentEvent.findMany({
        where: { accountId, activeSlot: 1 }, include: eventInclude,
      });
      const fifo = replayFifo(events);
      const { cash } = replayBalances(events);
      const instruments = await tx.instrument.findMany({ where: { id: { in: [
        ...new Set([...fifo.positions, ...fifo.sales].map((item) => item.instrumentId)),
      ] } }, select: instrumentSelect, orderBy: { id: 'asc' } });
      return { cash, ...fifo, instruments };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
  }

  instruments() {
    return this.accounts.safely(() => this.prisma.instrument.findMany({
      select: instrumentSelect, orderBy: [{ mic: 'asc' }, { ticker: 'asc' }, { id: 'asc' }], take: 1000,
    }));
  }
}
