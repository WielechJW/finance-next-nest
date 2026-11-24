import {
  expectedSession,
  previousDay,
  session,
} from '../market-data/calendar.js';
import {
  InvestmentCalculation as D,
  parseInvestmentDecimal,
} from '../investments/precision.js';
import { replayFifo, type FifoEvent } from '../investments/fifo.js';
import {
  defaultExecutionPolicy,
  dividendAmounts,
  priceAndCommission,
  validateCosts,
  type ExecutionPolicy,
  type FillCosts,
  type ReplayCorporateAction,
} from './execution-policy.js';
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
  startingCash:
    string | Partial<Record<StrategyInstrument['currency'], string>>;
  execution?: ExecutionPolicy;
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
  | {
      state: 'FILLED';
      price: string;
      quantity: string;
      commission: string;
      gross: string;
    }
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
): ReplayEvent & FifoEvent {
  const posting = preparePosting('simulation', input, currency, now);
  return {
    ...posting.timing,
    id: input.idempotencyKey,
    type: posting.type,
    split: posting.split,
    trade: posting.trade
      ? { ...posting.trade, instrument: { currency } }
      : null,
    openingLot: null,
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
  daySequence: number,
  costs: FillCosts,
): { attempt: Attempt; event?: ReplayEvent & FifoEvent } {
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
  const { price, commission, gross } = priceAndCommission(
    step.opening.price,
    input.orderQuantity,
    pending.signal.side,
    costs,
  );
  const event = replayEvent(
    {
      ...timing(step.sessionOn, daySequence),
      type: pending.signal.side,
      instrumentId: input.instrument.id,
      unitPrice: price,
      quantity: input.orderQuantity,
      commission,
    },
    input.instrument.currency,
    step.decidedAt,
  );
  const cashAfter = event.cashEntries.reduce(
    (amount, entry) => amount.plus(entry.amount.toString()),
    new D(state.cash[input.instrument.currency]),
  );
  if (cashAfter.lt(0))
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
      commission,
      gross,
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
  const policy = input.execution ?? defaultExecutionPolicy;
  validateCosts(policy.costs);
  if (policy.priceBasis !== 'RAW' && policy.priceBasis !== 'ADJUSTED')
    throw new Error('Podaj bazę cen modelu.');
  if (
    policy.priceBasis === 'ADJUSTED' &&
    (policy.actions.length || input.splits.length)
  )
    throw new Error(
      'Ceny skorygowane wymagają pominięcia osobnego księgowania splitów i dywidend.',
    );
  parseInvestmentDecimal(input.orderQuantity, 'quantity');
  checkSessions(sessions, instrument.mic);
  const first = sessions[0];
  const opening =
    typeof input.startingCash === 'string'
      ? { [instrument.currency]: input.startingCash }
      : input.startingCash;
  const ledger: (ReplayEvent & FifoEvent)[] = [];
  for (const currency of ['PLN', 'USD'] as const) {
    const amount = opening[currency] ?? '0';
    if (/^0(?:\.0{1,2})?$/.test(amount)) continue;
    const cash = parseInvestmentDecimal(amount, 'cashAmount');
    if (cash.lt(0)) throw new Error('Gotówka początkowa musi być nieujemna.');
    ledger.push(
      replayEvent(
        {
          ...timing(first.sessionOn, ledger.length + 1),
          type: 'DEPOSIT',
          currency,
          amount: cash.toFixed(),
        },
        instrument.currency,
        first.decidedAt,
      ),
    );
  }
  if (!ledger.length) throw new Error('Podaj dodatnie saldo początkowe.');
  const actions = [...policy.actions].sort(
    (a, b) => a.exDate.localeCompare(b.exDate) || a.id.localeCompare(b.id),
  );
  const applied = new Set<string>();
  const entitlement = new Map<string, string>();
  if (new Set(actions.map((action) => action.id)).size !== actions.length)
    throw new Error('Powtórzony identyfikator zdarzenia korporacyjnego.');
  for (const action of actions) {
    if (
      action.instrumentId !== instrument.id ||
      !session(instrument.mic, action.exDate).trading ||
      !Number.isFinite(action.availableAt.getTime()) ||
      (action.kind === 'DIVIDEND' && action.paymentOn < action.exDate)
    )
      throw new Error(
        'Nieprawidłowe zdarzenie korporacyjne dla zakresu symulacji.',
      );
  }
  const series: {
    sessionOn: string;
    balances: ReturnType<typeof replayBalances>;
  }[] = [];
  const decisions: { sessionOn: string; decision: StrategyDecision }[] = [];
  const attempts: Attempt[] = [];
  let pending: Pending | null = null;
  let balances = replayBalances(ledger);

  for (const step of sessions) {
    let sequence = step === first ? ledger.length : 0;
    const openingCutoff = new Date(step.sessionOn + 'T00:00:00Z');
    const preOpenHoldings = balances.securities[instrument.id] ?? '0';
    const record = (entry: PostInvestmentInput) => {
      ledger.push(replayEvent(entry, instrument.currency, step.decidedAt));
      balances = replayBalances(ledger);
    };
    const dividend = (
      action: Extract<ReplayCorporateAction, { kind: 'DIVIDEND' }>,
    ) => {
      if (action.exDate === step.sessionOn)
        entitlement.set(action.id, preOpenHoldings);
      const shares = entitlement.get(action.id);
      if (
        !shares ||
        applied.has(action.id) ||
        action.paymentOn > step.sessionOn ||
        action.availableAt > openingCutoff
      )
        return;
      applied.add(action.id);
      const amounts = dividendAmounts(
        shares,
        action.amountPerShare,
        action.withholdingBps,
      );
      if (new D(amounts.grossAmount).gt(0))
        record({
          ...timing(step.sessionOn, ++sequence),
          type: 'DIVIDEND',
          currency: instrument.currency,
          ...amounts,
        });
    };
    for (const action of actions) {
      if (action.kind === 'DIVIDEND') {
        dividend(action);
        continue;
      }
      if (action.exDate !== step.sessionOn) continue;
      if (action.availableAt > openingCutoff)
        throw new Error('Brak informacji o splicie przed sesją wykonania.');
      if (new D(preOpenHoldings).gt(0))
        record({
          ...timing(step.sessionOn, ++sequence),
          type: 'SPLIT',
          instrumentId: instrument.id,
          numerator: action.numerator,
          denominator: action.denominator,
        });
    }
    for (const { sessionOn, ...exchange } of policy.fx) {
      if (sessionOn === step.sessionOn)
        record({
          ...timing(step.sessionOn, ++sequence),
          type: 'FX',
          ...exchange,
        });
    }
    if (pending) {
      pending.waits++;
      const result = attemptOpen(
        pending,
        step,
        input,
        balances,
        ++sequence,
        policy.costs,
      );
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
      splits: [
        ...input.splits,
        ...actions.filter((action) => action.kind === 'SPLIT'),
      ].filter(
        (row) =>
          row.instrumentId === instrument.id &&
          row.exDate <= step.sessionOn &&
          row.availableAt <= step.decidedAt,
      ),
    });
    decisions.push({ sessionOn: step.sessionOn, decision });
    series.push({ sessionOn: step.sessionOn, balances });
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
  return {
    decisions,
    attempts,
    balances,
    series,
    fifo: replayFifo(ledger),
    priceBasis: policy.priceBasis,
  };
}
