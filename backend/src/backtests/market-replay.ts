import {
  expectedSession,
  previousDay,
  session,
} from '../market-data/calendar.js';
import {
  InvestmentCalculation as D,
  parseInvestmentDecimal,
} from '../investments/precision.js';
import {
  preparePosting,
  replayBalances,
  type PostInvestmentInput,
  type ReplayEvent,
} from '../investments/posting.js';
import type {
  StrategyBar,
  StrategyDecision,
  StrategyInstrument,
  StrategyRule,
  StrategySplit,
} from '../strategies/strategy.js';

export type ReplaySession = {
  sessionOn: string;
  decidedAt: Date;
  opening: { price: string; availableQuantity: string } | null;
};

export type ReplayInput<P> = {
  rule: StrategyRule<P>;
  instrument: StrategyInstrument;
  parameters: P;
  startingCash: string;
  orderQuantity: string;
  maxWaitSessions: number;
  sessions: readonly ReplaySession[];
  bars: readonly StrategyBar[];
  splits: readonly StrategySplit[];
};
type Signal = Extract<StrategyDecision, { kind: 'SIGNAL' }>;
type Pending = { signal: Signal; signalSessionOn: string; waits: number };
type Attempt = {
  sessionOn: string;
  signalSessionOn: string;
  side: Signal['side'];
} & (
  | { state: 'FILLED'; price: string; quantity: string }
  | { state: 'DEFERRED'; reason: 'NO_OPENING_QUOTE' }
  | {
      state: 'REJECTED';
      reason:
        | 'NO_OPENING_QUOTE'
        | 'INSUFFICIENT_LIQUIDITY'
        | 'INSUFFICIENT_CASH'
        | 'INSUFFICIENT_POSITION'
        | 'END_OF_PERIOD';
    }
);

function checkSessions(sessions: readonly ReplaySession[], mic: string) {
  if (!sessions.length)
    throw new Error('Test wymaga co najmniej jednej sesji.');
  for (const [index, row] of sessions.entries()) {
    if (
      !session(mic, row.sessionOn).trading ||
      expectedSession(mic, row.decidedAt) !== row.sessionOn
    )
      throw new Error(
        'Czas decyzji musi przypadać po publikacji kursu z sesji.',
      );
    if (index === 0) continue;
    const previous = sessions[index - 1];
    let next = previousDay(previous.sessionOn, -1);
    while (!session(mic, next).trading) next = previousDay(next, -1);
    if (row.sessionOn !== next || row.decidedAt <= previous.decidedAt)
      throw new Error(
        'Podaj kolejne sesje. Dla braku notowania przekaż pusty kurs otwarcia.',
      );
  }
}

function timing(sessionOn: string, daySequence: number) {
  return {
    accountId: 'simulation',
    idempotencyKey: `${sessionOn}:${daySequence}`,
    occurredOn: sessionOn,
    marketSessionOn: sessionOn,
    daySequence,
    timePrecision: 'DATE' as const,
  };
}

function replayEvent(
  input: PostInvestmentInput,
  currency: StrategyInstrument['currency'],
  now: Date,
): ReplayEvent {
  const posting = preparePosting('simulation', input, currency, now);
  return {
    ...posting.timing,
    type: posting.type,
    orderingSource: 'EXPLICIT',
    cashEntries: posting.cashEntries,
    securityEntries: posting.securityEntries,
  };
}

function attemptOpen(
  pending: Pending,
  step: ReplaySession,
  input: Pick<
    ReplayInput<unknown>,
    'instrument' | 'orderQuantity' | 'maxWaitSessions'
  >,
  state: ReturnType<typeof replayBalances>,
): { attempt: Attempt; event?: ReplayEvent } {
  const context = {
    sessionOn: step.sessionOn,
    signalSessionOn: pending.signalSessionOn,
    side: pending.signal.side,
  };
  if (!step.opening)
    return {
      attempt: {
        ...context,
        state: pending.waits < input.maxWaitSessions ? 'DEFERRED' : 'REJECTED',
        reason: 'NO_OPENING_QUOTE',
      },
    };
  const price = parseInvestmentDecimal(
    step.opening.price,
    'unitPrice',
  ).toFixed();
  if (!/^\d+(?:\.\d{1,10})?$/.test(step.opening.availableQuantity))
    throw new Error('Nieprawidłowa płynność modelu.');
  const available = new D(step.opening.availableQuantity);
  if (available.lt(input.orderQuantity))
    return {
      attempt: {
        ...context,
        state: 'REJECTED',
        reason: 'INSUFFICIENT_LIQUIDITY',
      },
    };
  if (
    pending.signal.side === 'SELL' &&
    new D(state.securities[input.instrument.id] ?? 0).lt(input.orderQuantity)
  )
    return {
      attempt: {
        ...context,
        state: 'REJECTED',
        reason: 'INSUFFICIENT_POSITION',
      },
    };
  const event = replayEvent(
    {
      ...timing(step.sessionOn, 1),
      type: pending.signal.side,
      instrumentId: input.instrument.id,
      unitPrice: price,
      quantity: input.orderQuantity,
    },
    input.instrument.currency,
    step.decidedAt,
  );
  if (
    pending.signal.side === 'BUY' &&
    event.cashEntries.some((cash) =>
      new D(state.cash[cash.currency]).plus(cash.amount.toString()).lt(0),
    )
  )
    return {
      attempt: { ...context, state: 'REJECTED', reason: 'INSUFFICIENT_CASH' },
    };
  return {
    event,
    attempt: {
      ...context,
      state: 'FILLED',
      price,
      quantity: input.orderQuantity,
    },
  };
}

export function replayMarket<P>(input: ReplayInput<P>) {
  const { instrument, sessions } = input;
  if (
    !Number.isInteger(input.maxWaitSessions) ||
    input.maxWaitSessions < 1 ||
    input.maxWaitSessions > 30
  )
    throw new Error('Termin oczekiwania może obejmować od 1 do 30 sesji.');
  const cash = parseInvestmentDecimal(input.startingCash, 'cashAmount');
  if (!cash.gt(0)) throw new Error('Gotówka początkowa musi być dodatnia.');
  parseInvestmentDecimal(input.orderQuantity, 'quantity');
  checkSessions(sessions, instrument.mic);
  const first = sessions[0];
  const ledger: ReplayEvent[] = [
    replayEvent(
      {
        ...timing(first.sessionOn, 1),
        type: 'DEPOSIT',
        currency: instrument.currency,
        amount: cash.toFixed(),
      },
      instrument.currency,
      first.decidedAt,
    ),
  ];
  const decisions: { sessionOn: string; decision: StrategyDecision }[] = [];
  const attempts: Attempt[] = [];
  let pending: Pending | null = null;
  let balances = replayBalances(ledger);

  for (const step of sessions) {
    if (pending) {
      pending.waits++;
      const result = attemptOpen(pending, step, input, balances);
      attempts.push(result.attempt);
      if (result.event) {
        ledger.push(result.event);
        balances = replayBalances(ledger);
      }
      if (result.attempt.state !== 'DEFERRED') pending = null;
    }
    const decision = input.rule.evaluate({
      instrument,
      parameters: input.parameters,
      decidedAt: step.decidedAt,
      portfolio: {
        cash: balances.cash[instrument.currency],
        quantity: balances.securities[instrument.id] ?? '0',
      },
      bars: input.bars.filter(
        (row) =>
          row.instrumentId === instrument.id &&
          row.sessionOn <= step.sessionOn &&
          row.availableAt <= step.decidedAt,
      ),
      splits: input.splits.filter(
        (row) =>
          row.instrumentId === instrument.id &&
          row.exDate <= step.sessionOn &&
          row.availableAt <= step.decidedAt,
      ),
    });
    decisions.push({ sessionOn: step.sessionOn, decision });
    if (
      !pending &&
      decision.kind === 'SIGNAL' &&
      Date.parse(decision.validUntil) > step.decidedAt.getTime()
    ) {
      pending = { signal: decision, signalSessionOn: step.sessionOn, waits: 0 };
    }
  }
  if (pending)
    attempts.push({
      sessionOn: sessions[sessions.length - 1].sessionOn,
      signalSessionOn: pending.signalSessionOn,
      side: pending.signal.side,
      state: 'REJECTED',
      reason: 'END_OF_PERIOD',
    });
  return { decisions, attempts, balances };
}
