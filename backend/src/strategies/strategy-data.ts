import type { Prisma } from '../generated/prisma/client.js';
import { replayBalances } from '../investments/posting.js';
import { previousDay, zonedClock } from '../market-data/calendar.js';
import type { StrategyInput, StrategyInstrument } from './strategy.js';

export type StrategySnapshot = ReturnType<typeof copySnapshot>;
const day = (value: Date) => value.toISOString().slice(0, 10);
const date = (value: string) => new Date(value + 'T00:00:00.000Z');

export function copySnapshot<P>({
  parameters: _parameters,
  decidedAt,
  bars,
  splits,
  ...state
}: StrategyInput<P> & { eventIds: string[] }) {
  return {
    ...state,
    decidedAt: decidedAt.toISOString(),
    bars: bars.map(({ availableAt, ...bar }) => ({
      ...bar,
      availableAt: availableAt.toISOString(),
    })),
    splits: splits.map(({ availableAt, ...split }) => ({
      ...split,
      availableAt: availableAt.toISOString(),
    })),
  };
}

export function restoreSnapshot<P>(
  snapshot: StrategySnapshot,
  parameters: P,
): StrategyInput<P> {
  return {
    ...snapshot,
    parameters,
    decidedAt: new Date(snapshot.decidedAt),
    bars: snapshot.bars.map((bar) => ({
      ...bar,
      availableAt: new Date(bar.availableAt),
    })),
    splits: snapshot.splits.map((split) => ({
      ...split,
      availableAt: new Date(split.availableAt),
    })),
  };
}

export async function collectStrategyData<P extends { slowSessions: number }>(
  tx: Prisma.TransactionClient,
  accountId: string,
  instrument: StrategyInstrument,
  decidedAt: Date,
  parameters: P,
) {
  const cutoff = zonedClock(decidedAt, 'Europe/Warsaw').day;
  // Allow weekends and holidays around the maximum span of trading sessions.
  const window = {
    gte: date(previousDay(cutoff, parameters.slowSessions * 2 + 10)),
    lte: date(cutoff),
  };
  const stored = await tx.priceBar.findMany({
    where: {
      instrumentId: instrument.id,
      source: 'EODHD',
      sessionOn: window,
      fetchedAt: { lte: decidedAt },
    },
    select: {
      id: true,
      instrumentId: true,
      sessionOn: true,
      fetchedAt: true,
      revision: true,
      close: true,
    },
    orderBy: [{ sessionOn: 'asc' }, { revision: 'asc' }, { id: 'asc' }],
  });
  const actions = await tx.corporateAction.findMany({
    where: {
      instrumentId: instrument.id,
      source: 'EODHD',
      kind: 'SPLIT',
      exDate: window,
      fetchedAt: { lte: decidedAt },
    },
    distinct: ['exDate'],
    orderBy: [{ exDate: 'asc' }, { revision: 'desc' }],
    select: { id: true, instrumentId: true, exDate: true, fetchedAt: true },
  });
  const known = await tx.investmentEvent.findMany({
    where: { accountId, recordedAt: { lte: decidedAt } },
    include: { cashEntries: true, securityEntries: true, split: true },
    orderBy: [{ occurredOn: 'asc' }, { daySequence: 'asc' }, { id: 'asc' }],
  });
  const superseded = new Set(known.map((row) => row.correctionOfId));
  const history = known.filter(
    (row) =>
      !superseded.has(row.id) &&
      day(row.occurredOn) <= cutoff &&
      (!row.executedAt || row.executedAt <= decidedAt),
  );
  const state = replayBalances(history);
  return {
    instrument,
    decidedAt,
    parameters,
    eventIds: history.map((row) => row.id),
    portfolio: {
      cash: state.cash[instrument.currency],
      quantity: state.securities[instrument.id] ?? '0.0000000000',
    },
    bars: stored.map(({ fetchedAt, sessionOn, close, ...bar }) => ({
      ...bar,
      availableAt: fetchedAt,
      sessionOn: day(sessionOn),
      close: close.toFixed(),
    })),
    splits: actions.map(({ exDate, fetchedAt, ...split }) => ({
      ...split,
      exDate: day(exDate),
      availableAt: fetchedAt,
    })),
  };
}
