import { alertTransition, type AlertState } from './transition.js';
const state: AlertState = { direction: 'ABOVE', mode: 'REARM', threshold: '50', armed: true, lastSatisfied: false,
  lastSessionOn: new Date('2026-11-10T00:00:00Z'), lastTriggeredAt: null, cooldownMinutes: 60, active: true };
describe('Daily price alert crossing rules', () => {
  it('establishes a first baseline and triggers on touching the threshold only after crossing', () => {
    expect(alertTransition({ ...state, lastSatisfied: null }, '60', '2026-11-12', new Date()).fire).toBe(false);
    expect(alertTransition(state, '50', '2026-11-12', new Date()).fire).toBe(true);
    expect(alertTransition({ ...state, armed: false, lastSatisfied: true }, '60', '2026-11-12', new Date()).fire).toBe(false);
  });
  it('does not trigger from same-day revisions or older observations', () => {
    expect(alertTransition(state, '60', '2026-11-10', new Date()).fire).toBe(false);
    expect(alertTransition(state, '60', '2026-11-09', new Date()).skip).toBe(true);
  });
  it('disables ONCE and requires rearming after a crossing suppressed by cooldown', () => {
    const now = new Date('2026-11-12T22:00:00Z');
    expect(alertTransition({ ...state, mode: 'ONCE' }, '50', '2026-11-12', now)).toMatchObject({ fire: true, active: false });
    expect(alertTransition({ ...state, lastTriggeredAt: now }, '50', '2026-11-12', now)).toMatchObject({ fire: false, armed: false });
    expect(alertTransition({ ...state, armed: false }, '49', '2026-11-12', now).armed).toBe(true);
  });
});
