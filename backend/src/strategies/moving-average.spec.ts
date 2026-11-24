import { describe, expect, it } from 'vitest';
import { movingAverage } from './moving-average.js';
import type { StrategyBar, StrategyInput } from './strategy.js';

type Input = Parameters<typeof movingAverage.evaluate>[0];
const parameters = { fastSessions: 2, slowSessions: 3, validForMinutes: 30 };
const instrument = { id: 'AAPL', mic: 'XNAS', currency: 'USD' } as const;
const decidedAt = new Date('2026-07-09T22:00:00Z');
const sessions = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09'];

function history(prices: string[]): StrategyBar[] {
  return prices.map((close, index) => ({
    id: `bar-${index}`,
    instrumentId: instrument.id,
    revision: 1,
    sessionOn: sessions[index],
    availableAt: new Date(sessions[index] + 'T21:45:00Z'),
    close,
  }));
}
function input(bars = history(['120', '85', '95', '125'])): Input {
  return {
    instrument,
    decidedAt,
    portfolio: { cash: '100.00', quantity: '0' },
    bars,
    splits: [],
    parameters,
  };
}

function evaluate(values: Partial<StrategyInput<typeof parameters>> = {}) {
  return movingAverage.evaluate({ ...input(), ...values });
}

describe('daily SMA crossover', () => {
  it('compares two consecutive sessions using exact decimals and sets the evidence and expiry', () => {
    expect(evaluate()).toMatchObject({
      kind: 'SIGNAL',
      side: 'BUY',
      instrumentId: instrument.id,
      decidedAt: '2026-07-09T22:00:00.000Z',
      validUntil: '2026-07-09T22:30:00.000Z',
      evidence: {
        expectedSessionOn: '2026-07-09',
        barIds: ['bar-3', 'bar-2', 'bar-1', 'bar-0'],
      },
      averages: {
        previousFast: '90.0000000000',
        previousSlow: '100.0000000000',
        fast: '110.0000000000',
        slow: '101.6666666667',
      },
    });
    expect(
      evaluate({
        bars: history(['80', '115', '105', '75']),
        portfolio: { cash: '0', quantity: '1.25' },
      }),
    ).toMatchObject({ kind: 'SIGNAL', side: 'SELL' });
    expect(evaluate({ portfolio: { cash: '0', quantity: '0' } })).toMatchObject(
      { kind: 'NO_SIGNAL', reason: 'PORTFOLIO_INELIGIBLE' },
    );
  });

  it('returns the same earlier decision regardless of ordering, later revisions or bars after the decision', () => {
    const original = input();
    const { bars, instrument: selected } = original;
    const later = [
      {
        ...bars[3],
        id: 'corrected',
        revision: 2,
        availableAt: new Date('2026-07-09T22:01:00Z'),
        close: '1',
      },
      {
        ...bars[3],
        id: 'future',
        availableAt: new Date('2026-07-10T21:45:00Z'),
        sessionOn: '2026-07-10',
        close: '5',
      },
      {
        ...bars[3],
        id: 'wrong-instrument',
        instrumentId: 'MSFT',
        revision: 2,
        close: '1',
      },
    ];
    const delayedSplit = {
      id: 'announced-later',
      instrumentId: selected.id,
      exDate: sessions[2],
      availableAt: new Date('2026-07-10T00:00:00Z'),
    };
    expect(
      evaluate({ bars: [...later, ...bars].reverse(), splits: [delayedSplit] }),
    ).toEqual(evaluate());
    const knownCorrection = {
      ...later[0],
      availableAt: new Date('2026-07-09T21:55:00Z'),
    };
    expect(evaluate({ bars: [...bars, knownCorrection] })).toMatchObject({
      kind: 'NO_SIGNAL',
      evidence: { barIds: ['corrected', 'bar-2', 'bar-1', 'bar-0'] },
    });
  });

  it('declines gaps, a stale close, unchanged direction and known splits', () => {
    expect(
      evaluate({ bars: history(['120', '85', '95', '125']).slice(0, 3) }),
    ).toMatchObject({ reason: 'STALE_PRICE' });
    expect(
      evaluate({
        bars: history(['120', '85', '95', '125']).filter(
          (_, index) => index !== 1,
        ),
      }),
    ).toMatchObject({ reason: 'INSUFFICIENT_HISTORY' });
    expect(
      evaluate({ bars: history(['100', '100', '100', '100']) }),
    ).toMatchObject({ reason: 'NO_CROSSOVER' });
    expect(
      evaluate({
        splits: [
          {
            id: 'stock-split',
            instrumentId: instrument.id,
            exDate: sessions[2],
            availableAt: decidedAt,
          },
        ],
      }),
    ).toMatchObject({ reason: 'SPLIT_IN_LOOKBACK' });
    expect(
      evaluate({ decidedAt: new Date('2025-07-09T22:00:00Z') }),
    ).toMatchObject({ reason: 'CALENDAR_UNAVAILABLE' });
  });

  it('rejects unsupported parameter sets', () => {
    expect(movingAverage.parseParameters(parameters)).toEqual(parameters);
    expect(() =>
      movingAverage.parseParameters({ ...parameters, future: true }),
    ).toThrow('nieobsługiwane');
    expect(() =>
      movingAverage.parseParameters({ ...parameters, slowSessions: 1 }),
    ).toThrow('średniej');
    expect(() =>
      movingAverage.parseParameters({ ...parameters, validForMinutes: 1441 }),
    ).toThrow('1440');
  });
});
