import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { InvestmentCurrency } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { replayFifo, type FifoEvent } from './fifo.js';
import { preparePosting, replayBalances, type PostInvestmentInput, type ReplayEvent } from './posting.js';

@Injectable()
export class InvestmentPostingService {
  constructor(private readonly prisma: PrismaService) {}

  async postForUser(userId: string, input: PostInvestmentInput): Promise<{ eventId: string; duplicate: boolean }> {
    if (!/^[0-9a-fA-F-]{36}$/.test(input.accountId)) {
      throw new BadRequestException('Niepoprawny identyfikator rachunku.');
    }
    return this.prisma.$transaction(async (tx) => {
      // Account lock serializes competing postings, balance checks and retries.
      const account = await tx.$queryRaw<{ id: string }[]>`
        SELECT a."id" FROM "InvestmentAccount" AS a
        JOIN "Portfolio" AS p ON p."id" = a."portfolioId"
        WHERE a."id" = ${input.accountId}::uuid AND p."userId" = ${userId}::uuid
        FOR UPDATE OF a
      `;
      if (account.length !== 1) throw new NotFoundException('Nie znaleziono rachunku inwestycyjnego.');

      let instrumentCurrency: InvestmentCurrency | undefined;
      if (input.type === 'BUY' || input.type === 'SELL' || input.type === 'OPENING_POSITION') {
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

      const history = await tx.investmentEvent.findMany({
        where: { accountId: input.accountId },
        orderBy: [{ occurredOn: 'asc' }, { daySequence: 'asc' }],
        include: {
          cashEntries: true,
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

  async balancesForUser(userId: string, accountId: string) {
    const account = await this.prisma.investmentAccount.findFirst({
      where: { id: accountId, portfolio: { userId } }, select: { id: true },
    });
    if (!account) throw new NotFoundException('Nie znaleziono rachunku inwestycyjnego.');
    const events = await this.prisma.investmentEvent.findMany({
      where: { accountId },
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
      where: { accountId },
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
