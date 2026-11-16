import { Prisma } from '../generated/prisma/client.js';

// Investment calculations must not inherit Decimal's default 20-digit context
// or change the configuration used by the existing budget domain.
export const InvestmentCalculation = Prisma.Decimal.clone({
  precision: 80,
  rounding: Prisma.Decimal.ROUND_HALF_UP,
});

export type InvestmentDecimalKind =
  | 'quantity'
  | 'securityQuantity'
  | 'unitPrice'
  | 'grossAmount'
  | 'cashAmount'
  | 'amount8'
  | 'fxRate';

const decimalRules: Record<
  InvestmentDecimalKind,
  { integerDigits: number; fractionDigits: number; sign: 'positive' | 'nonzero' | 'any' }
> = {
  quantity: { integerDigits: 18, fractionDigits: 10, sign: 'positive' },
  securityQuantity: { integerDigits: 18, fractionDigits: 10, sign: 'nonzero' },
  unitPrice: { integerDigits: 18, fractionDigits: 10, sign: 'positive' },
  grossAmount: { integerDigits: 20, fractionDigits: 2, sign: 'positive' },
  cashAmount: { integerDigits: 20, fractionDigits: 2, sign: 'nonzero' },
  amount8: { integerDigits: 20, fractionDigits: 8, sign: 'any' },
  fxRate: { integerDigits: 20, fractionDigits: 8, sign: 'positive' },
};

/** Public investment API contract: canonical decimal strings, never JS numbers. */
export function parseInvestmentDecimal(
  value: unknown,
  kind: InvestmentDecimalKind,
): Prisma.Decimal {
  const rule = decimalRules[kind];
  if (
    typeof value !== 'string' ||
    !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)
  ) {
    throw new Error(`${kind} must be a plain decimal string.`);
  }
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  if (whole.length > rule.integerDigits || fraction.length > rule.fractionDigits) {
    throw new Error(`${kind} exceeds its decimal precision.`);
  }
  const decimal = new Prisma.Decimal(value);
  if (
    (rule.sign === 'positive' && !decimal.gt(0)) ||
    (rule.sign === 'nonzero' && decimal.isZero())
  ) {
    throw new Error(`${kind} has an invalid sign or zero value.`);
  }
  return decimal.isZero() ? new Prisma.Decimal(0) : decimal;
}

export function formatInvestmentDecimal(
  value: Prisma.Decimal,
  kind: InvestmentDecimalKind,
): string {
  // Validate before toFixed(scale), which would otherwise silently round.
  parseInvestmentDecimal(value.toFixed(), kind);
  return value.toFixed(decimalRules[kind].fractionDigits);
}

export function calculateTradeGross(quantity: string, unitPrice: string): string {
  const parsedQuantity = parseInvestmentDecimal(quantity, 'quantity');
  const parsedPrice = parseInvestmentDecimal(unitPrice, 'unitPrice');
  const gross = new InvestmentCalculation(parsedQuantity.toFixed())
    .times(parsedPrice.toFixed())
    .toDecimalPlaces(2, InvestmentCalculation.ROUND_HALF_UP);
  const result = gross.toFixed(2);
  parseInvestmentDecimal(result, 'grossAmount');
  return result;
}

export function roundSettlementAmount(value: string): string {
  const amount = parseInvestmentDecimal(value, 'amount8');
  const rounded = new InvestmentCalculation(amount.toFixed())
    .toDecimalPlaces(2, InvestmentCalculation.ROUND_HALF_UP);
  const result = rounded.isZero() ? '0.00' : rounded.toFixed(2);
  parseInvestmentDecimal(result, 'amount8');
  return result;
}

/** PLN sold without commission divided by USD bought; original legs remain authoritative. */
export function calculateFxRatePlnPerUsd(plnSold: string, usdBought: string): string {
  const pln = parseInvestmentDecimal(plnSold, 'cashAmount');
  const usd = parseInvestmentDecimal(usdBought, 'cashAmount');
  if (!pln.gt(0) || !usd.gt(0)) {
    throw new Error('FX legs must be positive absolute amounts.');
  }
  const rate = new InvestmentCalculation(pln.toFixed())
    .div(usd.toFixed())
    .toDecimalPlaces(8, InvestmentCalculation.ROUND_HALF_UP);
  const result = rate.toFixed(8);
  parseInvestmentDecimal(result, 'fxRate');
  return result;
}
