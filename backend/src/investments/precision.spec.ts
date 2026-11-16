import { Prisma } from '../generated/prisma/client.js';
import {
  calculateFxRatePlnPerUsd,
  calculateTradeGross,
  formatInvestmentDecimal,
  parseInvestmentDecimal,
  roundSettlementAmount,
} from './precision.js';

describe('investment decimal contract', () => {
  it('accepts the full quantity, amount and rate ranges as strings', () => {
    expect(parseInvestmentDecimal('999999999999999999.9999999999', 'quantity').toFixed())
      .toBe('999999999999999999.9999999999');
    expect(parseInvestmentDecimal('99999999999999999999.99999999', 'amount8').toFixed())
      .toBe('99999999999999999999.99999999');
    expect(formatInvestmentDecimal(new Prisma.Decimal('0.25'), 'fxRate'))
      .toBe('0.25000000');
    expect(formatInvestmentDecimal(new Prisma.Decimal('-2.5'), 'cashAmount'))
      .toBe('-2.50');
  });

  it.each([
    [12, 'quantity'],
    ['1e3', 'quantity'],
    ['NaN', 'amount8'],
    ['Infinity', 'amount8'],
    [' 1.00', 'cashAmount'],
    ['1,00', 'cashAmount'],
    ['01.00', 'cashAmount'],
    ['1.00000000001', 'quantity'],
    ['1.000000001', 'amount8'],
    ['0.001', 'cashAmount'],
    ['1000000000000000000', 'quantity'],
    ['100000000000000000000', 'amount8'],
    ['0', 'quantity'],
    ['-1', 'unitPrice'],
    ['0.00', 'cashAmount'],
  ] as const)('rejects invalid %s for %s before database rounding', (value, kind) => {
    expect(() => parseInvestmentDecimal(value, kind)).toThrow();
  });

  it('rounds positive and negative halfway settlements away from zero', () => {
    expect(roundSettlementAmount('1.005')).toBe('1.01');
    expect(roundSettlementAmount('-1.005')).toBe('-1.01');
    expect(roundSettlementAmount('-0.004')).toBe('0.00');
    expect(() => roundSettlementAmount('99999999999999999999.99999999')).toThrow();
  });

  it('rounds gross once after multiplying exact quantity and price', () => {
    expect(calculateTradeGross('3', '0.335')).toBe('1.01');
  });

  it('keeps enough precision for large products and rejects overflow or zero gross', () => {
    expect(calculateTradeGross('100000000000000000', '0.1234567891'))
      .toBe('12345678910000000.00');
    expect(() => calculateTradeGross('999999999999999999', '999999999999999999'))
      .toThrow();
    expect(() => calculateTradeGross('0.0000000001', '0.0000000001'))
      .toThrow();
  });

  it('derives an eight-place PLN/USD rate from the actual FX cash legs', () => {
    expect(calculateFxRatePlnPerUsd('100.00', '25.00')).toBe('4.00000000');
    expect(calculateFxRatePlnPerUsd('1.00', '3.00')).toBe('0.33333333');
    expect(() => calculateFxRatePlnPerUsd('0', '25.00')).toThrow();
    expect(() => calculateFxRatePlnPerUsd('1.00', '99999999999999999999.99'))
      .toThrow();
  });
});
