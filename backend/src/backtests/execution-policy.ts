import {
  InvestmentCalculation as D,
  calculateTradeGross,
  parseInvestmentDecimal,
} from '../investments/precision.js';
import type { InvestmentCurrency } from '../generated/prisma/client.js';

export type FillCosts = {
  commissionFixed: string;
  commissionBps: number;
  spreadBps: number;
  slippageBps: number;
};
export type SessionFx = {
  sessionOn: string;
  soldCurrency: InvestmentCurrency;
  boughtCurrency: InvestmentCurrency;
  soldAmount: string;
  boughtAmount: string;
  commission?: string;
};
type Corporate = {
  id: string;
  instrumentId: string;
  exDate: string;
  availableAt: Date;
};
export type ReplayCorporateAction = Corporate &
  (
    | { kind: 'SPLIT'; numerator: string; denominator: string }
    | {
        kind: 'DIVIDEND';
        paymentOn: string;
        amountPerShare: string;
        withholdingBps: number;
      }
  );
export type ExecutionPolicy = {
  priceBasis: 'RAW' | 'ADJUSTED';
  costs: FillCosts;
  actions: readonly ReplayCorporateAction[];
  fx: readonly SessionFx[];
};
const noCosts: FillCosts = {
  commissionFixed: '0',
  commissionBps: 0,
  spreadBps: 0,
  slippageBps: 0,
};
export const defaultExecutionPolicy: ExecutionPolicy = {
  priceBasis: 'RAW',
  costs: noCosts,
  actions: [],
  fx: [],
};

export function validateCosts(costs: FillCosts) {
  if (
    !/^\d{1,20}(?:\.\d{1,2})?$/.test(costs.commissionFixed) ||
    ![costs.commissionBps, costs.spreadBps, costs.slippageBps].every(
      (value) => Number.isInteger(value) && value >= 0 && value <= 10000,
    ) ||
    costs.spreadBps / 2 + costs.slippageBps >= 10000
  )
    throw new Error('Koszty wykonania są poza zakresem modelu.');
}

export function priceAndCommission(
  open: string,
  quantity: string,
  side: 'BUY' | 'SELL',
  costs: FillCosts,
) {
  const midOpen = parseInvestmentDecimal(open, 'unitPrice');
  const impact = new D(costs.spreadBps)
    .div(2)
    .plus(costs.slippageBps)
    .div(10000);
  const price = new D(midOpen.toFixed())
    .times(side === 'BUY' ? impact.plus(1) : new D(1).minus(impact))
    .toDecimalPlaces(10, D.ROUND_HALF_UP)
    .toFixed();
  const gross = calculateTradeGross(quantity, price);
  const commission = new D(gross)
    .times(costs.commissionBps)
    .div(10000)
    .plus(costs.commissionFixed)
    .toFixed(2);
  return { price, commission, gross };
}

export function dividendAmounts(
  quantity: string,
  amountPerShare: string,
  withholdingBps: number,
) {
  if (
    !Number.isInteger(withholdingBps) ||
    withholdingBps < 0 ||
    withholdingBps > 10000
  )
    throw new Error('Stawka potrącenia dywidendy jest poza zakresem modelu.');
  const perShare = parseInvestmentDecimal(amountPerShare, 'unitPrice');
  const grossAmount = new D(quantity).times(perShare.toFixed()).toFixed(2);
  const withholdingTax = new D(grossAmount)
    .times(withholdingBps)
    .div(10000)
    .toFixed(2);
  return { grossAmount, withholdingTax };
}
