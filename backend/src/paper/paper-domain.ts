import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type {
  PaperEventKind,
  PaperOrderState,
  Prisma,
} from '../generated/prisma/client.js';
import {
  InvestmentCalculation as D,
  parseInvestmentDecimal,
  type InvestmentDecimalKind,
} from '../investments/precision.js';

export const paperHash = (data: unknown) =>
  createHash('sha256').update(JSON.stringify(data)).digest('hex');
export const paperDay = (date: Date) => date.toISOString().slice(0, 10);

export function paperDecimal(value: string, kind: InvestmentDecimalKind) {
  try {
    return parseInvestmentDecimal(value, kind).toFixed();
  } catch {
    throw new BadRequestException(
      'Nieprawidłowa kwota, ilość lub cena symulacji.',
    );
  }
}

export async function lockPaperAccount(
  tx: Prisma.TransactionClient,
  userId: string,
  connectionId: string,
) {
  const [account] = await tx.$queryRaw<
    {
      id: string;
      accountId: string;
      openingOn: Date;
      reconciliationRequired: boolean;
    }[]
  >`
    SELECT c."id", c."accountId", c."openingOn", c."reconciliationRequired" FROM "BrokerConnection" c
    JOIN "InvestmentAccount" a ON a."id" = c."accountId"
    JOIN "Portfolio" p ON p."id" = a."portfolioId"
    WHERE c."id" = ${connectionId}::uuid AND c."userId" = ${userId}::uuid AND p."userId" = ${userId}::uuid
      AND c.mode = 'LOCAL_PAPER' AND p.mode = 'PAPER'
    FOR UPDATE OF c, a
  `;
  if (!account)
    throw new NotFoundException('Nie znaleziono rachunku symulowanego.');
  return account;
}

type Event = { kind: PaperEventKind; happenedAt: Date };
export function projectPaperOrder(
  quantity: string,
  filled: string,
  events: Event[],
): PaperOrderState {
  if (new D(filled).eq(quantity)) return 'FILLED';
  const terminal = events
    .filter((event) => event.kind === 'CANCELLED' || event.kind === 'REJECTED')
    .sort(
      (a, b) =>
        a.happenedAt.getTime() - b.happenedAt.getTime() ||
        a.kind.localeCompare(b.kind),
    )[0];
  if (terminal) return terminal.kind === 'REJECTED' ? 'REJECTED' : 'CANCELLED';
  if (new D(filled).gt(0)) return 'PARTIALLY_FILLED';
  if (events.some((event) => event.kind === 'ACCEPTED')) return 'ACCEPTED';
  return events.some((event) => event.kind === 'SENT') ? 'SENT' : 'INTENT';
}

export function assertFillTiming(
  events: Event[],
  kind: PaperEventKind,
  happenedAt: Date,
  fills: { executedAt: Date }[],
) {
  if (
    kind === 'FILL' &&
    events.some(
      (event) =>
        event.kind === 'REJECTED' ||
        (event.kind === 'CANCELLED' && happenedAt > event.happenedAt),
    )
  )
    throw new ConflictException(
      'Wykonanie jest sprzeczne z zapisanym stanem zlecenia.',
    );
  if (
    (kind === 'REJECTED' && fills.length) ||
    (kind === 'CANCELLED' && fills.some((fill) => fill.executedAt > happenedAt))
  )
    throw new ConflictException(
      'Status jest sprzeczny z czasem potwierdzonego wykonania.',
    );
}
