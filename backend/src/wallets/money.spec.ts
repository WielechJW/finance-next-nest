import { Prisma } from '../generated/prisma/client.js';
import { formatMoney } from './money.js';

describe('money representation', () => {
  it.each([
    ['0', '0.00'],
    ['0.10', '0.10'],
    ['0.20', '0.20'],
    ['-123.45', '-123.45'],
    ['999999999999.99', '999999999999.99'],
    ['-999999999999.99', '-999999999999.99'],
  ])('serializes %s as %s', (input, expected) => {
    expect(formatMoney(new Prisma.Decimal(input))).toBe(expected);
  });

  it('adds 0.10 and 0.20 exactly and preserves two decimal places in JSON', () => {
    const amount = new Prisma.Decimal('0.10').plus(new Prisma.Decimal('0.20'));
    expect(amount.equals(new Prisma.Decimal('0.30'))).toBe(true);
    expect(JSON.stringify({ openingBalance: formatMoney(amount) })).toBe(
      '{"openingBalance":"0.30"}',
    );
  });
});
