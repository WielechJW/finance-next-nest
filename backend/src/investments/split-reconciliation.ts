import type { ReplayEvent } from './posting.js';
import { InvestmentCalculation as Decimal } from './precision.js';

type LedgerSplit = Pick<ReplayEvent, 'occurredOn' | 'split'> & { id: string };
type ReportedSplit = {
  instrumentId: string;
  exDate: Date;
  numerator: { toString(): string } | null;
  denominator: { toString(): string } | null;
};

export function splitOnDate(event: Pick<LedgerSplit, 'occurredOn' | 'split'>, instrumentId: string, date: Date) {
  return event.split?.instrumentId === instrumentId && event.occurredOn.getTime() === date.getTime();
}

export function reconcileSplit(events: LedgerSplit[], action: ReportedSplit) {
  let eventId: string | null = null;
  let numerator = new Decimal(1);
  let denominator = new Decimal(1);
  for (const event of events) {
    if (!event.split || !splitOnDate(event, action.instrumentId, action.exDate)) continue;
    eventId ??= event.id;
    numerator = numerator.times(event.split.numerator.toString());
    denominator = denominator.times(event.split.denominator.toString());
  }
  const matches = !!(eventId && action.numerator && action.denominator &&
    numerator.times(action.denominator.toString()).eq(denominator.times(action.numerator.toString())));
  return { eventId, matches };
}
