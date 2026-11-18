import { InvestmentCalculation as D } from '../investments/precision.js';

export type AlertState = { direction: string; mode: string; threshold: { toString(): string }; armed: boolean; lastSatisfied: boolean | null;
  lastSessionOn: Date | null; lastTriggeredAt: Date | null; cooldownMinutes: number; active: boolean };
export function alertTransition(state: AlertState, close: string, sessionOn: string, now: Date) {
  const satisfied = state.direction === 'ABOVE' ? new D(close).gte(state.threshold.toString()) : new D(close).lte(state.threshold.toString());
  const last = state.lastSessionOn?.toISOString().slice(0, 10);
  if (last && sessionOn < last) return { skip: true, fire: false, armed: state.armed, active: state.active, satisfied };
  if (state.lastSatisfied === null || sessionOn === last) return { skip: false, fire: false, armed: !satisfied, active: state.active, satisfied };
  const crossing = state.armed && satisfied;
  const cooled = !state.lastTriggeredAt || now.getTime() - state.lastTriggeredAt.getTime() >= state.cooldownMinutes * 60000;
  const fire = state.active && crossing && cooled;
  return { skip: false, fire, armed: satisfied ? false : true, active: fire && state.mode === 'ONCE' ? false : state.active, satisfied };
}
