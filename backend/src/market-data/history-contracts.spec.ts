import { parseActions, parseBars, parseNbp } from './history-contracts.js';

describe('Market history contracts', () => {
  const bar = { date: '2026-11-17', open: '50', high: '71', low: '49', close: '70', adjusted_close: '69', volume: '9007199254740993' };
  it('keeps raw and adjusted prices distinct and rejects impossible OHLC and duplicate days', () => {
    expect(parseBars([bar], bar.date, bar.date)[0]).toMatchObject({ close: '70.0000000000', adjustedClose: '69.0000000000', volume: bar.volume });
    expect(() => parseBars([{ ...bar, high: '60' }], bar.date, bar.date)).toThrow();
    expect(() => parseBars([bar, bar], bar.date, bar.date)).toThrow();
    expect(() => parseBars([bar], '2026-11-18', '2026-11-18')).toThrow();
  });
  it('records missing dividend payment dates and uses the unadjusted amount without inventing data', () => {
    expect(parseActions([{ date: bar.date, value: '1', unadjustedValue: '2', currency: 'PLN' }], 'DIVIDEND', 'PLN')[0]).toMatchObject({ amount: '2.00000000', paymentOn: null, amountBasis: 'unadjusted' });
    expect(() => parseActions([{ date: bar.date, value: '1', currency: 'USD' }], 'DIVIDEND', 'PLN')).toThrow();
    expect(() => parseActions([{ date: bar.date, split: '4/0' }], 'SPLIT', 'USD')).toThrow();
    expect(parseActions([{ date: bar.date, split: '4/1' }], 'SPLIT', 'USD')[0].numerator).toBe('4.0000000000');
  });
  it('accepts only the reference USD/PLN NBP table with publication date and table number', () => {
    expect(parseNbp({ code: 'USD', table: 'A', rates: [{ effectiveDate: bar.date, mid: '4.1234', no: '222/A/NBP/2026' }] })[0].rate).toBe('4.12340000');
    expect(() => parseNbp({ code: 'EUR', table: 'A', rates: [] })).toThrow();
  });
});
