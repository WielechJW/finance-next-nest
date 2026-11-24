import {
  InvestmentCalculation as D,
  parseInvestmentDecimal,
} from '../investments/precision.js';
import { expectedSession } from '../market-data/calendar.js';
import type { StrategyRule } from '../strategies/strategy.js';
import { defaultExecutionPolicy } from './execution-policy.js';
import { replayMarket, type ReplayInput } from './market-replay.js';

export type FxMark = {
  id: string;
  sessionOn: string;
  availableAt: Date;
  usdPln: string;
};
type Currency = 'PLN' | 'USD';
export type ReportInput<P> = ReplayInput<P> & {
  reportingCurrency: Currency;
  fxMarks: readonly FxMark[];
};
type Simulation = ReturnType<typeof replayMarket>;

function marks<P>(input: ReportInput<P>) {
  return input.sessions.map(({ sessionOn, decidedAt }) => {
    const bar = input.bars
      .filter(
        (row) =>
          row.instrumentId === input.instrument.id &&
          row.sessionOn === sessionOn &&
          row.availableAt <= decidedAt,
      )
      .sort(
        (a, b) =>
          b.revision - a.revision ||
          b.availableAt.getTime() - a.availableAt.getTime() ||
          b.id.localeCompare(a.id),
      )[0];
    const fx = input.fxMarks
      .filter(
        (row) =>
          row.sessionOn <= sessionOn &&
          row.availableAt <= decidedAt &&
          Date.parse(sessionOn) - Date.parse(row.sessionOn) <= 7 * 86400000,
      )
      .sort(
        (a, b) =>
          b.sessionOn.localeCompare(a.sessionOn) ||
          b.availableAt.getTime() - a.availableAt.getTime() ||
          b.id.localeCompare(a.id),
      )[0];
    return {
      close: bar
        ? parseInvestmentDecimal(bar.close, 'unitPrice').toFixed()
        : null,
      fx: fx ? parseInvestmentDecimal(fx.usdPln, 'fxRate').toFixed() : null,
    };
  });
}

function valueIn(
  value: string | InstanceType<typeof D>,
  currency: Currency,
  reportingCurrency: Currency,
  usdPln: string | null,
) {
  const amount = new D(value);
  if (currency === reportingCurrency || amount.isZero()) return amount;
  if (usdPln === null) return null;
  return reportingCurrency === 'PLN'
    ? amount.times(usdPln)
    : amount.div(usdPln);
}

function combinedCash(
  cash: Partial<Record<Currency, string>>,
  reportingCurrency: Currency,
  fx: string | null,
) {
  const pln = valueIn(cash.PLN ?? '0', 'PLN', reportingCurrency, fx);
  const usd = valueIn(cash.USD ?? '0', 'USD', reportingCurrency, fx);
  return pln && usd ? pln.plus(usd) : null;
}

function summarize<P>(
  input: ReportInput<P>,
  simulation: Simulation,
  inputs: ReturnType<typeof marks>,
) {
  const starting =
    typeof input.startingCash === 'string'
      ? { [input.instrument.currency]: input.startingCash }
      : input.startingCash;
  const initial = combinedCash(starting, input.reportingCurrency, inputs[0].fx);
  let peak = initial;
  let maxDrawdown = new D(0);
  let totalExposure = new D(0);
  const curve = simulation.series.map(({ sessionOn, balances }, index) => {
    const market = inputs[index];
    const cash = combinedCash(
      balances.cash,
      input.reportingCurrency,
      market.fx,
    );
    const quantity = new D(balances.securities[input.instrument.id] ?? 0);
    const securities = quantity.isZero()
      ? quantity
      : market.close === null
        ? null
        : valueIn(
            quantity.times(market.close),
            input.instrument.currency,
            input.reportingCurrency,
            market.fx,
          );
    if (!cash || !securities)
      return {
        sessionOn,
        capital: null,
        exposurePercent: null,
        drawdownPercent: null,
      };
    const capital = cash.plus(securities);
    if (!peak || capital.gt(peak)) peak = capital;
    const drawdown = peak.gt(0)
      ? peak.minus(capital).div(peak).times(100)
      : new D(0);
    if (drawdown.gt(maxDrawdown)) maxDrawdown = drawdown;
    const exposure = capital.gt(0)
      ? securities.div(capital).times(100)
      : new D(0);
    totalExposure = totalExposure.plus(exposure);
    return {
      sessionOn,
      capital: capital.toFixed(8),
      exposurePercent: exposure.toFixed(4),
      drawdownPercent: drawdown.toFixed(4),
    };
  });
  const marketByDay = new Map(
    input.sessions.map(({ sessionOn }, index) => [sessionOn, inputs[index]]),
  );
  const executions = simulation.attempts.filter(
    (entry) => entry.state === 'FILLED',
  );
  const turnover = executions.map((entry) =>
    valueIn(
      entry.gross,
      input.instrument.currency,
      input.reportingCurrency,
      marketByDay.get(entry.sessionOn)?.fx ?? null,
    ),
  );
  const valid = !!initial && curve.every((entry) => entry.capital !== null);
  const last = curve.at(-1)?.capital ?? null;
  return {
    initialCapital: initial?.toFixed(8) ?? null,
    finalCapital: last,
    profit:
      initial && last !== null ? new D(last).minus(initial).toFixed(8) : null,
    maxDrawdownPercent: valid ? maxDrawdown.toFixed(4) : null,
    averageExposurePercent: valid
      ? totalExposure.div(curve.length).toFixed(4)
      : null,
    turnover: turnover.every((value) => value !== null)
      ? turnover.reduce((sum, value) => sum.plus(value), new D(0)).toFixed(8)
      : null,
    executedTrades: executions.length,
    complete: valid,
    curve,
  };
}

function buyAndHold<P>(parameters: P): StrategyRule<P> {
  let staged = false;
  return {
    key: 'same-instrument-buy-and-hold',
    codeVersion: '1',
    parseParameters: () => parameters,
    evaluate: (input) => {
      const sessionOn = expectedSession(input.instrument.mic, input.decidedAt);
      const base = {
        instrumentId: input.instrument.id,
        decidedAt: input.decidedAt.toISOString(),
        evidence: {
          expectedSessionOn: sessionOn,
          barIds: input.bars
            .filter((bar) => bar.sessionOn === sessionOn)
            .map((bar) => bar.id),
          splitIds: [],
        },
      };
      if (
        staged ||
        !base.evidence.barIds.length ||
        !new D(input.portfolio.cash).gt(0)
      )
        return { ...base, kind: 'NO_SIGNAL', reason: 'NO_CROSSOVER' };
      staged = true;
      return {
        ...base,
        kind: 'SIGNAL',
        side: 'BUY',
        reason: 'Benchmark kup i trzymaj.',
        validUntil: new Date(input.decidedAt.getTime() + 60_000).toISOString(),
        averages: {
          previousFast: '0',
          previousSlow: '0',
          fast: '0',
          slow: '0',
        },
      };
    },
  };
}

export function buildBacktestReport<P>(input: ReportInput<P>) {
  const actual = replayMarket(input);
  const passive = replayMarket({
    ...input,
    rule: buyAndHold(input.parameters),
  });
  const valuations = marks(input);
  return {
    currency: input.reportingCurrency,
    priceBasis: actual.priceBasis,
    costs: (input.execution ?? defaultExecutionPolicy).costs,
    strategy: summarize(input, actual, valuations),
    benchmark: {
      key: 'same-instrument-buy-and-hold',
      ...summarize(input, passive, valuations),
    },
    attempts: actual.attempts,
    assumptions: {
      orderQuantity: input.orderQuantity,
      maxWaitSessions: input.maxWaitSessions,
      fillPrice: 'NEXT_OPEN',
      liquidity: 'ALL_OR_NONE',
      fxMarkMaximumCalendarDays: 7,
    },
  };
}
