import { describe, expect, it, vi } from 'vitest';
import { movingAverage } from '../strategies/moving-average.js';
import type { StrategyBar } from '../strategies/strategy.js';
import {
  replayMarket,
  type ReplayInput,
  type ReplaySession,
} from './market-replay.js';

const instrument = { id: 'aapl', mic: 'XNAS', currency: 'USD' } as const;
const parameters = { fastSessions: 2, slowSessions: 3, validForMinutes: 20 };
const history: StrategyBar[] = [
  ['2026-07-06', '120'],
  ['2026-07-07', '85'],
  ['2026-07-08', '95'],
  ['2026-07-09', '125'],
].map(([date, close], index) => ({
  id: String(index),
  instrumentId: instrument.id,
  sessionOn: date,
  availableAt: new Date(date + 'T21:50:00Z'),
  close,
  revision: 1,
}));
const session = (
  date: string,
  price: string | null,
  availableQuantity = '100',
): ReplaySession => ({
  sessionOn: date,
  decidedAt: new Date(date + 'T22:00:00Z'),
  opening: price ? { price, availableQuantity } : null,
});
const thursday = session('2026-07-09', '50');
const friday = session('2026-07-10', '130');
const monday = session('2026-07-13', '160');
function replay(extra: Partial<ReplayInput<typeof parameters>> = {}) {
  return replayMarket({
    rule: movingAverage,
    parameters,
    instrument,
    startingCash: '1000.00',
    orderQuantity: '2',
    maxWaitSessions: 2,
    sessions: [thursday, friday],
    bars: history,
    splits: [],
    ...extra,
  });
}

describe('market replay execution', () => {
  it('stages a close decision and fills on the following opening gap', () => {
    const result = replay();
    expect(result.decisions[0].decision).toMatchObject({
      kind: 'SIGNAL',
      side: 'BUY',
      evidence: { expectedSessionOn: '2026-07-09' },
    });
    expect(result.attempts).toEqual([
      {
        signalSessionOn: '2026-07-09',
        sessionOn: '2026-07-10',
        side: 'BUY',
        state: 'FILLED',
        price: '130',
        quantity: '2',
      },
    ]);
    expect(result.balances).toEqual({
      cash: { PLN: '0.00', USD: '740.00' },
      securities: { [instrument.id]: '2.0000000000' },
    });
    const closed = replay({ sessions: [thursday] });
    expect(closed.attempts[0]).toMatchObject({
      state: 'REJECTED',
      reason: 'END_OF_PERIOD',
    });
    expect(closed.balances.cash.USD).toBe('1000.00');
  });

  it('waits through a missing open and skips non-trading days', () => {
    const noQuote = session('2026-07-10', null);
    const result = replay({ sessions: [thursday, noQuote, monday] });
    expect(result.attempts).toMatchObject([
      {
        sessionOn: '2026-07-10',
        state: 'DEFERRED',
        reason: 'NO_OPENING_QUOTE',
      },
      { sessionOn: '2026-07-13', state: 'FILLED', price: '160' },
    ]);
    expect(
      replay({ sessions: [thursday, noQuote, monday], maxWaitSessions: 1 })
        .attempts,
    ).toMatchObject([
      {
        sessionOn: '2026-07-10',
        state: 'REJECTED',
        reason: 'NO_OPENING_QUOTE',
      },
    ]);
    expect(() => replay({ sessions: [thursday, monday] })).toThrow(
      'kolejne sesje',
    );
  });

  it('never exposes later sessions or unpublished revisions to the strategy', () => {
    const evaluate = vi.fn(
      (input: Parameters<typeof movingAverage.evaluate>[0]) =>
        movingAverage.evaluate(input),
    );
    const future = {
      ...history[3],
      id: 'future',
      revision: 2,
      close: '1',
      availableAt: new Date('2026-07-10T21:00:00Z'),
    };
    const fridayClose = {
      ...history[3],
      id: 'friday',
      sessionOn: '2026-07-10',
      close: '5',
      availableAt: new Date('2026-07-10T21:50:00Z'),
    };
    const result = replay({
      rule: { ...movingAverage, evaluate },
      bars: [...history, fridayClose, future],
    });
    expect(evaluate.mock.calls[0][0].bars.map((row) => row.id)).toEqual([
      '0',
      '1',
      '2',
      '3',
    ]);
    expect(evaluate.mock.calls[1][0].bars.map((row) => row.id)).toContain(
      'future',
    );
    expect(evaluate.mock.calls[1][0].portfolio.quantity).toBe('2.0000000000');
    expect(result.decisions[0]).toEqual(replay().decisions[0]);
  });

  it('records liquidity and gap-induced cash rejections without booking a fill', () => {
    expect(
      replay({ sessions: [thursday, session('2026-07-10', '130', '1.99')] })
        .attempts[0],
    ).toMatchObject({ reason: 'INSUFFICIENT_LIQUIDITY' });
    const result = replay({ startingCash: '120.00' });
    expect(result.attempts[0]).toMatchObject({
      state: 'REJECTED',
      reason: 'INSUFFICIENT_CASH',
    });
    expect(result.balances.cash.USD).toBe('120.00');
  });
});
