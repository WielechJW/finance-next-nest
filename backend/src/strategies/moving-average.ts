import {
  InvestmentCalculation as Decimal,
  parseInvestmentDecimal,
} from '../investments/precision.js';
import {
  expectedSession,
  previousDay,
  session,
} from '../market-data/calendar.js';
import { MarketDataError } from '../market-data/contracts.js';
import type {
  NoSignalReason,
  StrategyBar,
  StrategyDecision,
  StrategyEvidence,
  StrategyInput,
  StrategyRule,
} from './strategy.js';

type Parameters = {
  fastSessions: number;
  slowSessions: number;
  validForMinutes: number;
};
const parameterKeys = new Set([
  'fastSessions',
  'slowSessions',
  'validForMinutes',
]);

function parseParameters(input: unknown): Parameters {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Podaj ustawienia przecięcia średnich.');
  const fields = input as Record<string, unknown>;
  if (
    Object.keys(fields).length !== parameterKeys.size ||
    Object.keys(fields).some((key) => !parameterKeys.has(key))
  )
    throw new Error('Ustawienia zawierają nieobsługiwane pola.');
  const { fastSessions, slowSessions, validForMinutes } = fields;
  if (
    typeof fastSessions !== 'number' ||
    typeof slowSessions !== 'number' ||
    !Number.isInteger(fastSessions) ||
    !Number.isInteger(slowSessions) ||
    fastSessions < 2 ||
    fastSessions >= slowSessions ||
    slowSessions > 250
  ) {
    throw new Error(
      'Użyj co najmniej dwóch sesji dla szybkiej średniej i maksymalnie 250 dla długiej.',
    );
  }
  if (
    typeof validForMinutes !== 'number' ||
    !Number.isInteger(validForMinutes) ||
    validForMinutes < 1 ||
    validForMinutes > 1440
  )
    throw new Error('Ważność sygnału musi wynosić od 1 do 1440 minut.');
  return { fastSessions, slowSessions, validForMinutes };
}

function latestBySession(input: StrategyInput<Parameters>, cutoff: string) {
  const latest = new Map<string, StrategyBar>();
  const decidedAt = input.decidedAt.getTime();
  for (const bar of input.bars) {
    const available = bar.availableAt.getTime();
    if (
      bar.instrumentId !== input.instrument.id ||
      !Number.isFinite(available) ||
      available > decidedAt ||
      bar.sessionOn > cutoff
    )
      continue;
    const previous = latest.get(bar.sessionOn);
    if (
      !previous ||
      bar.revision > previous.revision ||
      (bar.revision === previous.revision &&
        (available > previous.availableAt.getTime() ||
          (available === previous.availableAt.getTime() &&
            bar.id > previous.id)))
    )
      latest.set(bar.sessionOn, bar);
  }
  return latest;
}

function evaluate(input: StrategyInput<Parameters>): StrategyDecision {
  const { fastSessions, slowSessions, validForMinutes } = parseParameters(
    input.parameters,
  );
  const base = {
    instrumentId: input.instrument.id,
    decidedAt: input.decidedAt.toISOString(),
  };
  const evidence: StrategyEvidence = {
    expectedSessionOn: null,
    barIds: [],
    splitIds: [],
  };
  function no(reason: NoSignalReason): StrategyDecision {
    return { ...base, evidence, kind: 'NO_SIGNAL', reason };
  }
  try {
    evidence.expectedSessionOn = expectedSession(
      input.instrument.mic,
      input.decidedAt,
    );
  } catch (error) {
    if (error instanceof MarketDataError && error.code === 'configuration')
      return no('CALENDAR_UNAVAILABLE');
    throw error;
  }
  const cutoff = evidence.expectedSessionOn;
  const prices = latestBySession(input, cutoff);
  if (!prices.has(cutoff)) return no('STALE_PRICE');

  const bars: StrategyBar[] = [];
  let day = cutoff;
  while (bars.length <= slowSessions) {
    try {
      if (session(input.instrument.mic, day).trading) {
        const bar = prices.get(day);
        if (!bar) return no('INSUFFICIENT_HISTORY');
        bars.push(bar);
        evidence.barIds.push(bar.id);
      }
    } catch (error) {
      if (error instanceof MarketDataError && error.code === 'configuration')
        return no('CALENDAR_UNAVAILABLE');
      throw error;
    }
    if (bars.length <= slowSessions) day = previousDay(day);
  }
  evidence.splitIds = input.splits
    .filter(
      (split) =>
        split.instrumentId === input.instrument.id &&
        split.availableAt <= input.decidedAt &&
        split.exDate >= day &&
        split.exDate <= cutoff,
    )
    .map((split) => split.id)
    .sort();
  if (evidence.splitIds.length) return no('SPLIT_IN_LOOKBACK');

  let values: InstanceType<typeof Decimal>[];
  try {
    values = bars.map(
      (bar) =>
        new Decimal(parseInvestmentDecimal(bar.close, 'unitPrice').toFixed()),
    );
  } catch {
    return no('INVALID_PRICE');
  }
  const sum = (count: number, start: number) =>
    values
      .slice(start, start + count)
      .reduce((total, price) => total.plus(price), new Decimal(0));
  const fast = sum(fastSessions, 0);
  const slow = sum(slowSessions, 0);
  const previousFast = sum(fastSessions, 1);
  const previousSlow = sum(slowSessions, 1);
  const relation = fast.times(slowSessions).cmp(slow.times(fastSessions));
  const previousRelation = previousFast
    .times(slowSessions)
    .cmp(previousSlow.times(fastSessions));
  const side =
    previousRelation <= 0 && relation > 0
      ? 'BUY'
      : previousRelation >= 0 && relation < 0
        ? 'SELL'
        : null;
  if (!side) return no('NO_CROSSOVER');
  const { quantity: held, cash: available } = input.portfolio;
  if (![held, available].every((value) => /^\d+(?:\.\d+)?$/.test(value)))
    return no('INVALID_PORTFOLIO');
  const quantity = new Decimal(held);
  const cash = new Decimal(available);
  if (side === 'BUY' ? !quantity.isZero() || !cash.gt(0) : !quantity.gt(0))
    return no('PORTFOLIO_INELIGIBLE');
  return {
    ...base,
    evidence: { ...evidence, expectedSessionOn: cutoff },
    kind: 'SIGNAL',
    side,
    reason:
      side === 'BUY'
        ? 'Szybka średnia zamknięcia przeszła ponad długą średnią.'
        : 'Szybka średnia zamknięcia przeszła poniżej długiej średniej.',
    validUntil: new Date(
      input.decidedAt.getTime() + validForMinutes * 60_000,
    ).toISOString(),
    averages: {
      previousFast: previousFast.div(fastSessions).toFixed(10),
      previousSlow: previousSlow.div(slowSessions).toFixed(10),
      fast: fast.div(fastSessions).toFixed(10),
      slow: slow.div(slowSessions).toFixed(10),
    },
  };
}

export const movingAverage: StrategyRule<Parameters> = {
  key: 'daily-sma-crossover',
  codeVersion: '1',
  parseParameters,
  evaluate,
};
