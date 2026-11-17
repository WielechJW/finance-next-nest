import type { PostInvestmentInput } from '../../src/investments/posting.js';

// Acceptance values are calculated by hand, independently of the ledger engine.
export const investmentExpected = {
  deposited: { cash: '1000.00' },
  bought: { cash: '495.00', quantity: '10.0000000000', cost: '505.00000000' },
  sold: {
    cash: '733.00', quantity: '6.0000000000', cost: '303.00000000',
    soldCost: '202.00000000', netProceeds: '238.00', result: '36.00000000',
  },
  corrected: {
    cash: '683.00', quantity: '6.0000000000', cost: '333.00000000',
    soldCost: '222.00000000', result: '16.00000000',
  },
  closed: { cash: '1091.00', netProceeds: '358.00', result: '55.00000000' },
} as const;

export function investmentScenario(accountId: string, instrumentId: string) {
  const common = { accountId, occurredOn: '2026-11-10', timePrecision: 'DATE' as const };
  return {
    deposit: { ...common, daySequence: 1, idempotencyKey: 'scenario-deposit',
      type: 'DEPOSIT', currency: 'PLN', amount: '1000.00' },
    buy: { ...common, daySequence: 2, idempotencyKey: 'scenario-buy',
      type: 'BUY', instrumentId, quantity: '10', unitPrice: '50', commission: '5.00' },
    sell: { ...common, daySequence: 3, idempotencyKey: 'scenario-sell',
      type: 'SELL', instrumentId, quantity: '4', unitPrice: '60', commission: '2.00' },
  } satisfies Record<string, PostInvestmentInput>;
}
