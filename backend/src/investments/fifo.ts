import { ConflictException } from '@nestjs/common';
import type { CashEntryKind, InvestmentCurrency } from '../generated/prisma/client.js';
import { InvestmentCalculation, parseInvestmentDecimal } from './precision.js';

type Amount = InstanceType<typeof InvestmentCalculation>;
type DecimalLike = { toString(): string };

export type FifoEvent = {
  id: string;
  type: string;
  occurredOn: Date;
  daySequence: number;
  orderingSource: 'EXPLICIT' | 'MIGRATED_UNVERIFIED';
  trade: {
    instrumentId: string;
    quantity: DecimalLike;
    grossAmount: DecimalLike;
    instrument: { currency: InvestmentCurrency };
  } | null;
  openingLot: {
    instrumentId: string;
    quantity: DecimalLike;
    totalCost: DecimalLike;
    acquiredOn: Date;
    instrument: { currency: InvestmentCurrency };
  } | null;
  cashEntries: { kind: CashEntryKind; currency: InvestmentCurrency; amount: DecimalLike }[];
  securityEntries: { instrumentId: string; quantity: DecimalLike }[];
};

type Lot = {
  eventId: string;
  acquiredOn: Date;
  originalQuantity: Amount;
  originalCost: Amount;
  remainingQuantity: Amount;
  allocatedCost: Amount;
};

type Position = { currency: InvestmentCurrency; lots: Lot[] };

function decimal(value: DecimalLike): Amount {
  return new InvestmentCalculation(value.toString());
}

function assertSecurityEffect(event: FifoEvent, instrumentId: string, expected: Amount) {
  let actual = new InvestmentCalculation(0);
  for (const entry of event.securityEntries) {
    if (entry.instrumentId !== instrumentId) {
      throw new ConflictException('Wpis ilościowy wskazuje inny instrument.');
    }
    actual = actual.plus(entry.quantity.toString());
  }
  if (!actual.eq(expected)) throw new ConflictException('Wpis ilościowy nie zgadza się z operacją.');
}

function tradeCommission(event: FifoEvent, currency: InvestmentCurrency, gross: Amount): Amount {
  let grossCash = new InvestmentCalculation(0);
  let commission = new InvestmentCalculation(0);
  for (const entry of event.cashEntries) {
    if (entry.currency !== currency) throw new ConflictException('Prowizja musi być w walucie instrumentu.');
    if (entry.kind === 'TRADE_GROSS') grossCash = grossCash.plus(entry.amount.toString());
    else if (entry.kind === 'COMMISSION') commission = commission.minus(entry.amount.toString());
    else throw new ConflictException('Nieznany składnik gotówkowy transakcji.');
  }
  const expectedGross = event.type === 'BUY' ? gross.neg() : gross;
  if (!grossCash.eq(expectedGross) || commission.lt(0)) {
    throw new ConflictException('Wpisy gotówkowe nie zgadzają się z transakcją.');
  }
  return commission;
}

/** Rebuilds cost lots and realized sales from the ordered event ledger. */
export function replayFifo(events: FifoEvent[]) {
  const positions = new Map<string, Position>();
  const sales: {
    eventId: string;
    instrumentId: string;
    currency: InvestmentCurrency;
    quantity: string;
    netProceeds: string;
    cost: string;
    result: string;
    allocations: { lotEventId: string; quantity: string; cost: string }[];
  }[] = [];
  const ordered = [...events].sort((a, b) => a.occurredOn.getTime() - b.occurredOn.getTime() || a.daySequence - b.daySequence);
  for (const event of ordered) {
    if (event.orderingSource !== 'EXPLICIT' || event.type === 'CORRECTION' || event.type === 'SPLIT') {
      throw new ConflictException('Historia wymaga rozstrzygnięcia kolejności, korekty lub splitu.');
    }
    if (event.type === 'OPENING_POSITION') {
      if (!event.openingLot || event.trade || event.cashEntries.length > 0) {
        throw new ConflictException('Partia otwarcia wymaga jawnego kosztu i daty.');
      }
      const opening = event.openingLot;
      const quantity = decimal(opening.quantity);
      const cost = decimal(opening.totalCost);
      if (!quantity.gt(0) || cost.lt(0) || opening.acquiredOn > event.occurredOn) {
        throw new ConflictException('Niepoprawna partia otwarcia.');
      }
      assertSecurityEffect(event, opening.instrumentId, quantity);
      const position: Position = positions.get(opening.instrumentId) ?? { currency: opening.instrument.currency, lots: [] };
      if (position.currency !== opening.instrument.currency) throw new ConflictException('Niezgodna waluta instrumentu.');
      position.lots.push({ eventId: event.id, acquiredOn: opening.acquiredOn,
        originalQuantity: quantity, originalCost: cost, remainingQuantity: quantity,
        allocatedCost: new InvestmentCalculation(0) });
      positions.set(opening.instrumentId, position);
      continue;
    }
    if (event.type !== 'BUY' && event.type !== 'SELL') {
      if (event.trade || event.openingLot || event.securityEntries.length > 0) {
        throw new ConflictException('Zdarzenie gotówkowe ma nieoczekiwane wpisy ilościowe.');
      }
      continue;
    }
    if (!event.trade || event.openingLot) throw new ConflictException('Brak danych transakcji.');
    const trade = event.trade;
    const quantity = decimal(trade.quantity);
    const gross = decimal(trade.grossAmount);
    if (!quantity.gt(0) || !gross.gt(0)) throw new ConflictException('Niepoprawna ilość lub kwota transakcji.');
    assertSecurityEffect(event, trade.instrumentId, event.type === 'BUY' ? quantity : quantity.neg());
    const commission = tradeCommission(event, trade.instrument.currency, gross);
    const position: Position = positions.get(trade.instrumentId) ?? { currency: trade.instrument.currency, lots: [] };
    if (position.currency !== trade.instrument.currency) throw new ConflictException('Niezgodna waluta instrumentu.');
    if (event.type === 'BUY') {
      const cost = gross.plus(commission);
      parseInvestmentDecimal(cost.toFixed(8), 'amount8');
      position.lots.push({ eventId: event.id, acquiredOn: event.occurredOn,
        originalQuantity: quantity, originalCost: cost, remainingQuantity: quantity,
        allocatedCost: new InvestmentCalculation(0) });
      positions.set(trade.instrumentId, position);
      continue;
    }
    let remaining = quantity;
    let consumedCost = new InvestmentCalculation(0);
    const allocations: { lotEventId: string; quantity: string; cost: string }[] = [];
    for (const lot of position.lots) {
      if (remaining.isZero()) break;
      if (lot.remainingQuantity.isZero()) continue;
      const consumed = remaining.lt(lot.remainingQuantity) ? remaining : lot.remainingQuantity;
      const newRemaining = lot.remainingQuantity.minus(consumed);
      const cumulativeQuantity = lot.originalQuantity.minus(newRemaining);
      const cumulativeCost = newRemaining.isZero()
        ? lot.originalCost
        : lot.originalCost.times(cumulativeQuantity).div(lot.originalQuantity)
          .toDecimalPlaces(8, InvestmentCalculation.ROUND_HALF_UP);
      const allocated = cumulativeCost.minus(lot.allocatedCost);
      lot.remainingQuantity = newRemaining;
      lot.allocatedCost = cumulativeCost;
      remaining = remaining.minus(consumed);
      consumedCost = consumedCost.plus(allocated);
      allocations.push({ lotEventId: lot.eventId, quantity: consumed.toFixed(10), cost: allocated.toFixed(8) });
    }
    if (!remaining.isZero()) throw new ConflictException('Niewystarczająca ilość instrumentu dla FIFO.');
    const netProceeds = gross.minus(commission);
    sales.push({ eventId: event.id, instrumentId: trade.instrumentId,
      currency: trade.instrument.currency, quantity: quantity.toFixed(10),
      netProceeds: netProceeds.toFixed(2), cost: consumedCost.toFixed(8),
      result: netProceeds.minus(consumedCost).toFixed(8), allocations });
    positions.set(trade.instrumentId, position);
  }
  return {
    positions: [...positions].flatMap(([instrumentId, position]) => {
      const lots = position.lots.filter((lot) => !lot.remainingQuantity.isZero()).map((lot) => ({
        eventId: lot.eventId,
        acquiredOn: lot.acquiredOn.toISOString().slice(0, 10),
        quantity: lot.remainingQuantity.toFixed(10),
        cost: lot.originalCost.minus(lot.allocatedCost).toFixed(8),
      }));
      if (lots.length === 0) return [];
      return [{ instrumentId, currency: position.currency,
        quantity: lots.reduce((sum, lot) => sum.plus(lot.quantity), new InvestmentCalculation(0)).toFixed(10),
        cost: lots.reduce((sum, lot) => sum.plus(lot.cost), new InvestmentCalculation(0)).toFixed(8),
        lots }];
    }).sort((a, b) => a.instrumentId.localeCompare(b.instrumentId)),
    sales,
  };
}
