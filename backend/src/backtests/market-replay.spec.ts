import { describe, expect, it, vi } from 'vitest';
import { defaultExecutionPolicy } from './execution-policy.js';
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
        commission: '0.00',
        gross: '260.00',
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

  it('books FX, fills with costs, preserves FIFO cost across a split and credits the later dividend', () => {
    const steps = [
      thursday,
      session('2026-07-10', '20'),
      monday,
      session('2026-07-14', null),
      session('2026-07-15', null),
    ];
    const result = replay({
      sessions: steps,
      startingCash: { PLN: '500.00', USD: '0.00' },
      execution: {
        priceBasis: 'RAW',
        costs: {
          commissionFixed: '1',
          commissionBps: 100,
          spreadBps: 200,
          slippageBps: 100,
        },
        fx: [
          {
            sessionOn: '2026-07-09',
            soldCurrency: 'PLN',
            boughtCurrency: 'USD',
            soldAmount: '400',
            boughtAmount: '100',
            commission: '2',
          },
        ],
        actions: [
          {
            id: 'split',
            kind: 'SPLIT',
            instrumentId: instrument.id,
            exDate: '2026-07-13',
            availableAt: new Date('2026-07-09T18:00:00Z'),
            numerator: '2',
            denominator: '1',
          },
          {
            id: 'dividend',
            kind: 'DIVIDEND',
            instrumentId: instrument.id,
            exDate: '2026-07-14',
            availableAt: new Date('2026-07-09T18:00:00Z'),
            paymentOn: '2026-07-15',
            amountPerShare: '2',
            withholdingBps: 2500,
          },
        ],
      },
    });
    expect(result.attempts[0]).toMatchObject({
      state: 'FILLED',
      price: '20.4',
      commission: '1.41',
      gross: '40.80',
    });
    expect(result.series[1].balances).toMatchObject({
      cash: { PLN: '98.00', USD: '57.79' },
      securities: { [instrument.id]: '2.0000000000' },
    });
    expect(result.series[2].balances.securities[instrument.id]).toBe(
      '4.0000000000',
    );
    expect(result.series[3].balances.cash.USD).toBe('57.79');
    expect(result.balances.cash.USD).toBe('63.79');
    expect(result.fifo.positions[0]).toMatchObject({
      currency: 'USD',
      quantity: '4.0000000000',
      cost: '42.21000000',
    });
  });

  it('rejects fills that cannot cover the commission, and blocks mixing adjusted prices with corporate actions', () => {
    const result = replay({
      startingCash: '260.00',
      execution: {
        ...defaultExecutionPolicy,
        costs: { ...defaultExecutionPolicy.costs, commissionFixed: '1' },
      },
    });
    expect(result.attempts[0]).toMatchObject({
      state: 'REJECTED',
      reason: 'INSUFFICIENT_CASH',
    });
    const action = {
      id: 'split',
      kind: 'SPLIT' as const,
      instrumentId: instrument.id,
      exDate: '2026-07-10',
      availableAt: new Date('2026-07-10T16:00:00Z'),
      numerator: '2',
      denominator: '1',
    };
    expect(() =>
      replay({
        execution: {
          ...defaultExecutionPolicy,
          priceBasis: 'ADJUSTED',
          actions: [action],
        },
      }),
    ).toThrow('Ceny skorygowane');
    expect(() =>
      replay({ execution: { ...defaultExecutionPolicy, actions: [action] } }),
    ).toThrow('Brak informacji o splicie');
  });
});
