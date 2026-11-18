import { marketDecimal, parseCatalog, parseMarketJson } from './contracts.js';

describe('Market data provider contracts', () => {
  it('preserves decimals and large integer lexemes without Number rounding', () => {
    const data = parseMarketJson('{"price":12345678901234567.1234567890,"volume":9007199254740993}') as { price: string; volume: string };
    expect(marketDecimal(data.price)).toBe('12345678901234567.1234567890');
    expect(marketDecimal(data.volume, 0, true)).toBe('9007199254740993');
    expect(() => marketDecimal('1.12345678901')).toThrow();
    expect(() => marketDecimal('-1')).toThrow();
  });
  it('requires supported market, currency and equity identity and rejects duplicate symbols', () => {
    const row = { Code: 'TEST', Exchange: 'NASDAQ', Currency: 'USD', Type: 'Common Stock', Name: 'Test company' };
    expect(parseCatalog([row], 'US')[0]).toMatchObject({ mic: 'XNAS', symbol: 'TEST.US' });
    expect(() => parseCatalog([{ ...row, Exchange: 'UNKNOWN' }], 'US')).toThrow();
    expect(() => parseCatalog([row, row], 'US')).toThrow();
    expect(() => parseCatalog([{ ...row, Currency: 'PLN' }], 'US')).toThrow();
  });
});
