import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { InvestmentCurrency } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { replayFifo, type FifoEvent } from './fifo.js';
import { preparePosting, replayBalances, type PostInvestmentInput, type ReplayEvent } from './posting.js';

export type CorrectInvestmentInput = {
  accountId: string;
  targetEventId: string;
  expectedRevision: number;
  reason: string;
  idempotencyKey: string;
  // null cancels the event; a replacement is a complete new economic version.
  replacement: PostInvestmentInput | null;
};

@Injectable()
export class InvestmentPostingService {
  constructor(private readonly prisma: PrismaService) {}

  async postForUser(userId: string, input: PostInvestmentInput): Promise<{ eventId: string; duplicate: boolean }> {
    if (!/^[0-9a-fA-F-]{36}$/.test(input.accountId)) {
      throw new BadRequestException('Niepoprawny identyfikator rachunku.');
    }
    return this.prisma.$transaction(async (tx) => {
      // Account lock serializes competing postings, balance checks and retries.
      const account = await tx.$queryRaw<{ id: string; archivedAt: Date | null }[]>`
        SELECT a."id", a."archivedAt" FROM "InvestmentAccount" AS a
        JOIN "Portfolio" AS p ON p."id" = a."portfolioId"
        WHERE a."id" = ${input.accountId}::uuid AND p."userId" = ${userId}::uuid
        FOR UPDATE OF a
      `;
      if (account.length !== 1) throw new NotFoundException('Nie znaleziono rachunku inwestycyjnego.');

      let instrumentCurrency: InvestmentCurrency | undefined;
      if (input.type === 'BUY' || input.type === 'SELL' || input.type === 'OPENING_POSITION' || input.type === 'SPLIT') {
        const instrument = await tx.instrument.findUnique({
          where: { id: input.instrumentId }, select: { currency: true },
        });
        if (!instrument) throw new NotFoundException('Nie znaleziono instrumentu.');
        instrumentCurrency = instrument.currency;
      }
      const posting = preparePosting(userId, input, instrumentCurrency);
      const payloadHash = createHash('sha256').update(JSON.stringify({
        ...posting, idempotencyKey: undefined,
      })).digest('hex');
      const existing = await tx.investmentEvent.findMany({
        where: {
          accountId: input.accountId,
          OR: [
            { idempotencyKey: posting.idempotencyKey },
            ...(posting.externalOperationId ? [{
              source: posting.source,
              sourceKey: posting.sourceKey,
              externalOperationId: posting.externalOperationId,
            }] : []),
          ],
        },
        select: { id: true, payloadHash: true },
      });
      if (existing.length > 0) {
        if (existing.length !== 1 || existing[0].payloadHash !== payloadHash) {
          throw new ConflictException('Klucz operacji był już użyty dla innej treści.');
        }
        return { eventId: existing[0].id, duplicate: true };
      }
      if (account[0].archivedAt) throw new ConflictException('Rachunek jest zarchiwizowany.');

      const history = await tx.investmentEvent.findMany({
        where: { accountId: input.accountId, activeSlot: 1 },
        orderBy: [{ occurredOn: 'asc' }, { daySequence: 'asc' }],
        include: {
          cashEntries: true,
          split: true,
          securityEntries: true,
          trade: { include: { instrument: { select: { currency: true } } } },
          openingLot: { include: { instrument: { select: { currency: true } } } },
        },
      });
      const candidate: ReplayEvent = {
        occurredOn: posting.timing.occurredOn,
        daySequence: posting.timing.daySequence,
        executedAt: posting.timing.executedAt,
        orderingSource: 'EXPLICIT',
        type: posting.type,
        split: posting.split,
        cashEntries: posting.cashEntries,
        securityEntries: posting.securityEntries,
      };
      replayBalances([...history, candidate]);
      const fifoCandidate: FifoEvent = {
        ...candidate,
        id: 'candidate',
        cashEntries: posting.cashEntries,
        trade: posting.trade ? { ...posting.trade, instrument: { currency: instrumentCurrency! } } : null,
        openingLot: posting.openingLot ? { ...posting.openingLot, instrument: { currency: instrumentCurrency! } } : null,
      };
      replayFifo([...history, fifoCandidate]);

      const event = await tx.investmentEvent.create({
        data: {
          accountId: posting.accountId,
          corporateActionId: posting.corporateActionId,
          type: posting.type,
          source: posting.source,
          sourceKey: posting.sourceKey,
          externalOperationId: posting.externalOperationId,
          idempotencyKey: posting.idempotencyKey,
          payloadHash,
          recordedBy: posting.recordedBy,
          ...posting.timing,
          fxRatePlnPerUsd: posting.fxRatePlnPerUsd,
        },
      });
      if (posting.split) await tx.investmentSplit.create({ data: { eventId: event.id, ...posting.split } });
      if (posting.trade) {
        await tx.trade.create({ data: { eventId: event.id, ...posting.trade } });
      }
      if (posting.openingLot) {
        await tx.openingLot.create({ data: { eventId: event.id, ...posting.openingLot } });
      }
      if (posting.cashEntries.length > 0) {
        await tx.cashEntry.createMany({
          data: posting.cashEntries.map((entry) => ({ eventId: event.id, ...entry })),
        });
      }
      if (posting.securityEntries.length > 0) {
        await tx.securityEntry.createMany({
          data: posting.securityEntries.map((entry) => ({ eventId: event.id, ...entry })),
        });
      }
      return { eventId: event.id, duplicate: false };
    }, { timeout: 30000 });
  }

  async correctForUser(userId: string, input: CorrectInvestmentInput): Promise<{
    eventId: string; duplicate: boolean; revision: number;
  }> {
    if (!/^[0-9a-fA-F-]{36}$/.test(input.accountId) ||
        !/^[0-9a-fA-F-]{36}$/.test(input.targetEventId)) {
      throw new BadRequestException('Niepoprawny identyfikator rachunku lub zdarzenia.');
    }
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new BadRequestException('Wymagana poprawna wersja zdarzenia.');
    }
    if (typeof input.reason !== 'string' || input.reason.length > 500 ||
        input.reason.trim() !== input.reason || input.reason.length === 0) {
      throw new BadRequestException('Wymagany powód korekty.');
    }
    if (typeof input.idempotencyKey !== 'string' || input.idempotencyKey.length < 1 ||
        input.idempotencyKey.length > 128 || input.idempotencyKey.trim() !== input.idempotencyKey) {
      throw new BadRequestException('Wymagany klucz idempotencji korekty.');
    }
    if (input.replacement && (input.replacement.accountId !== input.accountId ||
        input.replacement.idempotencyKey !== input.idempotencyKey)) {
      throw new BadRequestException('Zamiennik musi dotyczyć tego samego rachunku i żądania.');
    }

    return this.prisma.$transaction(async (tx) => {
      const account = await tx.$queryRaw<{ id: string; archivedAt: Date | null }[]>`
        SELECT a."id", a."archivedAt" FROM "InvestmentAccount" AS a
        JOIN "Portfolio" AS p ON p."id" = a."portfolioId"
        WHERE a."id" = ${input.accountId}::uuid AND p."userId" = ${userId}::uuid
        FOR UPDATE OF a
      `;
      if (account.length !== 1) throw new NotFoundException('Nie znaleziono rachunku inwestycyjnego.');

      let instrumentCurrency: InvestmentCurrency | undefined;
      if (input.replacement && (input.replacement.type === 'BUY' ||
          input.replacement.type === 'SELL' || input.replacement.type === 'OPENING_POSITION' || input.replacement.type === 'SPLIT')) {
        const instrument = await tx.instrument.findUnique({
          where: { id: input.replacement.instrumentId }, select: { currency: true },
        });
        if (!instrument) throw new NotFoundException('Nie znaleziono instrumentu.');
        instrumentCurrency = instrument.currency;
      }
      const posting = input.replacement
        ? preparePosting(userId, input.replacement, instrumentCurrency)
        : null;
      if (posting && posting.source !== 'MANUAL') {
        throw new BadRequestException('Korekta użytkownika musi być wpisem ręcznym.');
      }
      const payloadHash = createHash('sha256').update(JSON.stringify({
        targetEventId: input.targetEventId,
        expectedRevision: input.expectedRevision,
        reason: input.reason,
        replacement: posting ? { ...posting, idempotencyKey: undefined } : null,
      })).digest('hex');
      const existing = await tx.investmentEvent.findFirst({
        where: { accountId: input.accountId, idempotencyKey: input.idempotencyKey },
        select: { id: true, payloadHash: true, revision: true },
      });
      if (existing) {
        if (existing.payloadHash !== payloadHash) {
          throw new ConflictException('Klucz operacji był już użyty dla innej treści.');
        }
        return { eventId: existing.id, duplicate: true, revision: existing.revision };
      }
      if (account[0].archivedAt) throw new ConflictException('Rachunek jest zarchiwizowany.');

      const target = await tx.investmentEvent.findFirst({
        where: { id: input.targetEventId, accountId: input.accountId },
      });
      if (!target) throw new NotFoundException('Nie znaleziono korygowanego zdarzenia.');
      if (target.activeSlot !== 1 || target.revision !== input.expectedRevision ||
          (target.type === 'CORRECTION' && target.revision === 0)) {
        throw new ConflictException('Zdarzenie ma już nowszą wersję lub wymaga wyjaśnienia starej korekty.');
      }
      const timing = posting?.timing ?? {
        occurredOn: target.occurredOn,
        timePrecision: target.timePrecision,
        executedAt: target.executedAt,
        sourceTimeZone: target.sourceTimeZone,
        marketSessionOn: target.marketSessionOn,
        settledOn: target.settledOn,
        daySequence: target.daySequence,
      };
      const revision = target.revision + 1;
      const history = await tx.investmentEvent.findMany({
        where: { accountId: input.accountId, activeSlot: 1, id: { not: target.id } },
        orderBy: [{ occurredOn: 'asc' }, { daySequence: 'asc' }],
        include: {
          cashEntries: true,
          split: true,
          securityEntries: true,
          trade: { include: { instrument: { select: { currency: true } } } },
          openingLot: { include: { instrument: { select: { currency: true } } } },
        },
      });
      const candidate: ReplayEvent = {
        ...timing,
        type: posting?.type ?? 'CORRECTION',
        split: posting?.split,
        revision,
        correctionOfId: target.id,
        orderingSource: 'EXPLICIT',
        cashEntries: posting?.cashEntries ?? [],
        securityEntries: posting?.securityEntries ?? [],
      };
      replayBalances([...history, candidate]);
      const fifoCandidate: FifoEvent = {
        ...candidate,
        id: 'candidate',
        cashEntries: posting?.cashEntries ?? [],
        trade: posting?.trade ? { ...posting.trade, instrument: { currency: instrumentCurrency! } } : null,
        openingLot: posting?.openingLot ? { ...posting.openingLot, instrument: { currency: instrumentCurrency! } } : null,
      };
      replayFifo([...history, fifoCandidate]);

      await tx.investmentEvent.update({ where: { id: target.id }, data: { activeSlot: null } });
      const event = await tx.investmentEvent.create({
        data: {
          accountId: input.accountId,
          type: posting?.type ?? 'CORRECTION',
          source: 'MANUAL',
          sourceKey: 'manual',
          externalOperationId: null,
          idempotencyKey: input.idempotencyKey,
          payloadHash,
          recordedBy: `user:${userId}`,
          ...timing,
          orderingSource: 'EXPLICIT',
          fxRatePlnPerUsd: posting?.fxRatePlnPerUsd ?? null,
          correctionOfId: target.id,
          correctionReason: input.reason,
          revision,
          activeSlot: 1,
        },
      });
      if (posting?.split) await tx.investmentSplit.create({ data: { eventId: event.id, ...posting.split } });
      if (posting?.trade) await tx.trade.create({ data: { eventId: event.id, ...posting.trade } });
      if (posting?.openingLot) await tx.openingLot.create({ data: { eventId: event.id, ...posting.openingLot } });
      if (posting?.cashEntries.length) {
        await tx.cashEntry.createMany({ data: posting.cashEntries.map((entry) => ({ eventId: event.id, ...entry })) });
      }
      if (posting?.securityEntries.length) {
        await tx.securityEntry.createMany({ data: posting.securityEntries.map((entry) => ({ eventId: event.id, ...entry })) });
      }
      return { eventId: event.id, duplicate: false, revision };
    }, { timeout: 30000 });
  }

  async balancesForUser(userId: string, accountId: string) {
    const account = await this.prisma.investmentAccount.findFirst({
      where: { id: accountId, portfolio: { userId } }, select: { id: true },
    });
    if (!account) throw new NotFoundException('Nie znaleziono rachunku inwestycyjnego.');
    const events = await this.prisma.investmentEvent.findMany({
      where: { accountId, activeSlot: 1 },
      orderBy: [{ occurredOn: 'asc' }, { daySequence: 'asc' }],
      include: { cashEntries: true, securityEntries: true },
    });
    return replayBalances(events);
  }

  async positionsForUser(userId: string, accountId: string) {
    const account = await this.prisma.investmentAccount.findFirst({
      where: { id: accountId, portfolio: { userId } }, select: { id: true },
    });
    if (!account) throw new NotFoundException('Nie znaleziono rachunku inwestycyjnego.');
    const events = await this.prisma.investmentEvent.findMany({
      where: { accountId, activeSlot: 1 },
      orderBy: [{ occurredOn: 'asc' }, { daySequence: 'asc' }],
      include: {
        cashEntries: true,
        securityEntries: true,
        trade: { include: { instrument: { select: { currency: true } } } },
        openingLot: { include: { instrument: { select: { currency: true } } } },
      },
    });
    replayBalances(events);
    return replayFifo(events);
  }
}
