import { BadRequestException, ConflictException } from '@nestjs/common';
import type { CashEntryKind, InvestmentCurrency, InvestmentEventSource } from '../generated/prisma/client.js';
import {
  InvestmentCalculation,
  calculateFxRatePlnPerUsd,
  calculateTradeGross,
  formatInvestmentDecimal,
  parseInvestmentDecimal,
} from './precision.js';
import { parseInvestmentCalendarDate, parseInvestmentTiming, type InvestmentTimingInput } from './timing.js';

type BaseInput = InvestmentTimingInput & {
  accountId: string;
  idempotencyKey: string;
  source?: InvestmentEventSource;
  sourceKey?: string;
  externalOperationId?: string;
};

export type PostInvestmentInput = BaseInput & (
  | { type: 'DEPOSIT' | 'WITHDRAWAL'; currency: InvestmentCurrency; amount: string }
  | { type: 'BUY' | 'SELL'; instrumentId: string; quantity: string; unitPrice: string; commission?: string }
  | { type: 'DIVIDEND'; currency: InvestmentCurrency; grossAmount: string; withholdingTax?: string; fee?: string }
  | { type: 'FEE'; currency: InvestmentCurrency; amount: string }
  | { type: 'OPENING_POSITION'; instrumentId: string; quantity: string; totalCost: string; acquiredOn: string }
  | { type: 'FX'; soldCurrency: InvestmentCurrency; boughtCurrency: InvestmentCurrency; soldAmount: string; boughtAmount: string; commission?: string }
);

export type CashEffect = { kind: CashEntryKind; currency: InvestmentCurrency; amount: string };
export type SecurityEffect = { instrumentId: string; quantity: string };
export type TradeEffect = { instrumentId: string; quantity: string; unitPrice: string; grossAmount: string };
export type OpeningLotEffect = { instrumentId: string; quantity: string; totalCost: string; acquiredOn: Date };

export type PreparedPosting = {
  accountId: string;
  type: PostInvestmentInput['type'];
  source: InvestmentEventSource;
  sourceKey: string;
  externalOperationId: string | null;
  idempotencyKey: string;
  recordedBy: string;
  timing: ReturnType<typeof parseInvestmentTiming>;
  fxRatePlnPerUsd: string | null;
  trade: TradeEffect | null;
  openingLot?: OpeningLotEffect;
  cashEntries: CashEffect[];
  securityEntries: SecurityEffect[];
};

function currency(value: InvestmentCurrency): InvestmentCurrency {
  if (value !== 'PLN' && value !== 'USD') {
    throw new BadRequestException('Nieobsługiwana waluta inwestycji.');
  }
  return value;
}

function positiveCash(value: string): string {
  const parsed = parseInvestmentDecimal(value, 'cashAmount');
  if (!parsed.gt(0)) throw new BadRequestException('Kwota musi być dodatnia.');
  return parsed.toFixed(2);
}

function nonnegativeCash(value: string | undefined): string {
  if (value === undefined) return '0.00';
  const parsed = parseInvestmentDecimal(value, 'amount8');
  if (parsed.lt(0)) throw new BadRequestException('Opłata lub podatek nie może być ujemny.');
  if ((value.split('.')[1]?.length ?? 0) > 2) {
    throw new BadRequestException('Opłata lub podatek musi być rozliczony do groszy.');
  }
  return parsed.isZero() ? '0.00' : formatInvestmentDecimal(parsed, 'cashAmount');
}

function negative(value: string): string {
  return new InvestmentCalculation(value).neg().toFixed(2);
}

export function preparePosting(
  userId: string,
  input: PostInvestmentInput,
  instrumentCurrency?: InvestmentCurrency,
  now = new Date(),
): PreparedPosting {
  try {
    const source = input.source ?? 'MANUAL';
    const sourceKey = input.sourceKey ?? (source === 'MANUAL' ? 'manual' : '');
    if (!/^[a-z0-9][a-z0-9._:-]*$/.test(sourceKey) || sourceKey.length > 100 ||
        (source === 'MANUAL') !== (sourceKey === 'manual')) {
      throw new BadRequestException('Niepoprawny klucz źródła.');
    }
    if (typeof input.idempotencyKey !== 'string' ||
        input.idempotencyKey.length < 1 || input.idempotencyKey.length > 128 ||
        input.idempotencyKey !== input.idempotencyKey.trim()) {
      throw new BadRequestException('Wymagany poprawny klucz idempotencji.');
    }
    const externalOperationId = input.externalOperationId ?? null;
    if ((source === 'MANUAL' && externalOperationId !== null) ||
        (source !== 'MANUAL' && (externalOperationId === null ||
          externalOperationId.length < 1 || externalOperationId.length > 128 ||
          externalOperationId !== externalOperationId.trim()))) {
      throw new BadRequestException('Niepoprawny identyfikator operacji źródłowej.');
    }
    const timing = parseInvestmentTiming(input, now);
    const common = {
      accountId: input.accountId,
      type: input.type,
      source,
      sourceKey,
      externalOperationId,
      idempotencyKey: input.idempotencyKey,
      recordedBy: `user:${userId}`,
      timing,
    };
    if (input.type === 'DEPOSIT' || input.type === 'WITHDRAWAL') {
      const amount = positiveCash(input.amount);
      return { ...common, fxRatePlnPerUsd: null, trade: null, securityEntries: [],
        cashEntries: [{ kind: 'EXTERNAL_TRANSFER', currency: currency(input.currency), amount: input.type === 'DEPOSIT' ? amount : negative(amount) }] };
    }
    if (input.type === 'BUY' || input.type === 'SELL') {
      if (!instrumentCurrency) throw new BadRequestException('Nie znaleziono waluty instrumentu.');
      const quantity = formatInvestmentDecimal(parseInvestmentDecimal(input.quantity, 'quantity'), 'quantity');
      const unitPrice = formatInvestmentDecimal(parseInvestmentDecimal(input.unitPrice, 'unitPrice'), 'unitPrice');
      const grossAmount = calculateTradeGross(quantity, unitPrice);
      const commission = nonnegativeCash(input.commission);
      const cashEntries: CashEffect[] = [{ kind: 'TRADE_GROSS', currency: currency(instrumentCurrency), amount: input.type === 'BUY' ? negative(grossAmount) : grossAmount }];
      if (commission !== '0.00') cashEntries.push({ kind: 'COMMISSION', currency: instrumentCurrency, amount: negative(commission) });
      return { ...common, fxRatePlnPerUsd: null,
        trade: { instrumentId: input.instrumentId, quantity, unitPrice, grossAmount },
        cashEntries,
        securityEntries: [{ instrumentId: input.instrumentId, quantity: input.type === 'BUY' ? quantity : new InvestmentCalculation(quantity).neg().toFixed(10) }] };
    }
    if (input.type === 'DIVIDEND') {
      const gross = positiveCash(input.grossAmount);
      const tax = nonnegativeCash(input.withholdingTax);
      const fee = nonnegativeCash(input.fee);
      if (new InvestmentCalculation(tax).plus(fee).gt(gross)) {
        throw new BadRequestException('Podatek i opłata przekraczają dywidendę brutto.');
      }
      const cashEntries: CashEffect[] = [{ kind: 'DIVIDEND_GROSS', currency: currency(input.currency), amount: gross }];
      if (tax !== '0.00') cashEntries.push({ kind: 'WITHHOLDING_TAX', currency: input.currency, amount: negative(tax) });
      if (fee !== '0.00') cashEntries.push({ kind: 'FEE', currency: input.currency, amount: negative(fee) });
      return { ...common, fxRatePlnPerUsd: null, trade: null, securityEntries: [], cashEntries };
    }
    if (input.type === 'FEE') {
      return { ...common, fxRatePlnPerUsd: null, trade: null, securityEntries: [],
        cashEntries: [{ kind: 'FEE', currency: currency(input.currency), amount: negative(positiveCash(input.amount)) }] };
    }
    if (input.type === 'OPENING_POSITION') {
      if (!instrumentCurrency) throw new BadRequestException('Nie znaleziono waluty instrumentu.');
      const quantity = formatInvestmentDecimal(parseInvestmentDecimal(input.quantity, 'quantity'), 'quantity');
      const cost = parseInvestmentDecimal(input.totalCost, 'amount8');
      if (cost.lt(0)) throw new BadRequestException('Koszt partii otwarcia nie może być ujemny.');
      const acquiredOn = parseInvestmentCalendarDate(input.acquiredOn, 'acquiredOn');
      if (acquiredOn > timing.occurredOn) {
        throw new BadRequestException('Data nabycia nie może być późniejsza od daty otwarcia.');
      }
      return { ...common, fxRatePlnPerUsd: null, trade: null, cashEntries: [],
        openingLot: { instrumentId: input.instrumentId, quantity, totalCost: cost.toFixed(8), acquiredOn },
        securityEntries: [{ instrumentId: input.instrumentId, quantity }] };
    }
    if (input.type !== 'FX') throw new BadRequestException('Nieobsługiwany typ operacji.');
    if (input.soldCurrency === input.boughtCurrency) {
      throw new BadRequestException('Wymiana wymaga dwóch różnych walut.');
    }
    const sold = positiveCash(input.soldAmount);
    const bought = positiveCash(input.boughtAmount);
    const commission = nonnegativeCash(input.commission);
    const soldCurrency = currency(input.soldCurrency);
    const boughtCurrency = currency(input.boughtCurrency);
    const cashEntries: CashEffect[] = [
      { kind: 'FX', currency: soldCurrency, amount: negative(sold) },
      { kind: 'FX', currency: boughtCurrency, amount: bought },
    ];
    if (commission !== '0.00') cashEntries.push({ kind: 'COMMISSION', currency: soldCurrency, amount: negative(commission) });
    return { ...common, fxRatePlnPerUsd: calculateFxRatePlnPerUsd(
      soldCurrency === 'PLN' ? sold : bought,
      soldCurrency === 'USD' ? sold : bought,
    ), trade: null, securityEntries: [], cashEntries };
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException(error instanceof Error ? error.message : 'Niepoprawna operacja inwestycyjna.');
  }
}

export type ReplayEvent = {
  occurredOn: Date;
  daySequence: number;
  executedAt: Date | null;
  orderingSource: 'EXPLICIT' | 'MIGRATED_UNVERIFIED';
  type: string;
  revision?: number;
  correctionOfId?: string | null;
  cashEntries: { currency: InvestmentCurrency; amount: { toString(): string } }[];
  securityEntries: { instrumentId: string; quantity: { toString(): string } }[];
};

export function replayBalances(events: ReplayEvent[]) {
  const cash = new Map<InvestmentCurrency, InstanceType<typeof InvestmentCalculation>>([
    ['PLN', new InvestmentCalculation(0)], ['USD', new InvestmentCalculation(0)],
  ]);
  const securities = new Map<string, InstanceType<typeof InvestmentCalculation>>();
  const ordered = [...events].sort((a, b) => a.occurredOn.getTime() - b.occurredOn.getTime() || a.daySequence - b.daySequence);
  let previousDate = '';
  let previousSequence = 0;
  let previousInstant: Date | null = null;
  for (const event of ordered) {
    if (event.orderingSource !== 'EXPLICIT' || (event.type === 'CORRECTION' &&
        !(event.revision && event.revision > 0 && event.correctionOfId &&
          event.cashEntries.length === 0 && event.securityEntries.length === 0))) {
      throw new ConflictException('Historia wymaga potwierdzenia kolejności lub korekty przed księgowaniem.');
    }
    const date = event.occurredOn.toISOString().slice(0, 10);
    if (date !== previousDate) { previousDate = date; previousSequence = 0; previousInstant = null; }
    if (event.daySequence === previousSequence) throw new ConflictException('Zajęta pozycja w dniu.');
    previousSequence = event.daySequence;
    if (event.executedAt) {
      if (previousInstant && event.executedAt < previousInstant) throw new ConflictException('Kolejność przeczy czasom wykonania.');
      previousInstant = event.executedAt;
    }
    const cashImpact = new Map<InvestmentCurrency, InstanceType<typeof InvestmentCalculation>>();
    for (const entry of event.cashEntries) {
      cashImpact.set(entry.currency, (cashImpact.get(entry.currency) ?? new InvestmentCalculation(0)).plus(entry.amount.toString()));
    }
    for (const [currency, impact] of cashImpact) {
      const balance = cash.get(currency)!.plus(impact);
      if (balance.lt(0)) throw new ConflictException(`Niewystarczająca gotówka ${currency}.`);
      cash.set(currency, balance);
    }
    const securityImpact = new Map<string, InstanceType<typeof InvestmentCalculation>>();
    for (const entry of event.securityEntries) {
      securityImpact.set(entry.instrumentId, (securityImpact.get(entry.instrumentId) ?? new InvestmentCalculation(0)).plus(entry.quantity.toString()));
    }
    for (const [instrumentId, impact] of securityImpact) {
      const quantity = (securities.get(instrumentId) ?? new InvestmentCalculation(0)).plus(impact);
      if (quantity.lt(0)) throw new ConflictException('Niewystarczająca ilość instrumentu.');
      securities.set(instrumentId, quantity);
    }
  }
  return {
    cash: Object.fromEntries([...cash].map(([key, value]) => [key, value.toFixed(2)])) as Record<InvestmentCurrency, string>,
    securities: Object.fromEntries([...securities].map(([key, value]) => [key, value.toFixed(10)])) as Record<string, string>,
  };
}
