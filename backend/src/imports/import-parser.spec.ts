import { describe, expect, it } from 'vitest';
import { parseImportCsv } from './import-parser.js';
import { maxImportBytes } from './csv-reader.js';

const fields =
  'type;occurredOn;currency;amount;ticker;mic;quantity;unitPrice;commission;externalId;executedAt;sourceTimeZone';
const deposit = 'DEPOSIT;09.01.2025;PLN;1000,01;;;;;;wpłata;;';

function generic(...lines: string[]) {
  return parseImportCsv(
    Buffer.from([fields, ...lines].join('\r\n')),
    'GENERIC',
  );
}

describe('investment import CSV', () => {
  it('preserves decimals, handles Polish dates, and checks timestamp and DST against Warsaw accounting dates', () => {
    const good =
      'BUY;2025-01-10;USD;;AAPL;XNAS;002,300;100.123;1,00;test;2025-01-09T23:15:00-05:00;America/New_York';
    const invalid =
      'BUY;2025-03-30;PLN;;CDR;XWAR;2;100;1;test;2025-03-30T02:30:00+01:00;Europe/Warsaw';
    const parsed = generic(deposit, '', good, invalid);
    expect(parsed).toMatchObject({
      encoding: 'utf-8',
      separator: ';',
      rows: [
        {
          number: 2,
          data: {
            occurredOn: '2025-01-09',
            amount: '1000.01',
            externalId: 'wpłata',
          },
          error: null,
        },
        {
          number: 4,
          data: {
            ticker: 'AAPL',
            quantity: '2.3',
            unitPrice: '100.123',
            commission: '1',
          },
          error: null,
        },
        {
          number: 5,
          data: null,
          error: expect.stringMatching(/sourceTimeZone/),
        },
      ],
    });
  });

  it('decodes UTF-16 BOM with tab and Windows-1250 with semicolon', () => {
    const utf16 = Buffer.from(
      '\ufefftype\toccurredOn\tcurrency\tamount\nDEPOSIT\t2025-01-09\tPLN\t9',
      'utf16le',
    );
    expect(parseImportCsv(utf16, 'GENERIC')).toMatchObject({
      encoding: 'utf-16le',
      separator: '\t',
      rows: [{ error: null }],
    });
    const windows = Buffer.from(
      fields + '\n' + deposit.replace('ł', '\u00b3'),
      'latin1',
    );
    expect(parseImportCsv(windows, 'GENERIC')).toMatchObject({
      encoding: 'windows-1250',
      rows: [{ data: { externalId: 'wpłata' } }],
    });
  });

  it('reports malformed, unsafe or financially invalid rows without deleting later rows', () => {
    const result = generic(
      '"broken',
      'DEPOSIT;2025-02-31;PLN;9;;;;;;;;',
      'DEPOSIT;2025-01-01;EUR;9;;;;;;;;',
      'DEPOSIT;2025-01-01;USD;9;;;;;;"quote"" and ; delimiter";;',
    );
    expect(result.rows).toEqual([
      { number: 2, data: null, error: expect.stringContaining('cudzysłowy') },
      {
        number: 3,
        data: null,
        error: expect.stringContaining('calendar date'),
      },
      { number: 4, data: null, error: expect.stringContaining('PLN i USD') },
      {
        number: 5,
        error: null,
        data: expect.objectContaining({ externalId: 'quote" and ; delimiter' }),
      },
    ]);
    expect(() => generic(...Array(5001).fill(deposit))).toThrow('5000');
    expect(() =>
      parseImportCsv(Buffer.alloc(maxImportBytes + 1), 'GENERIC'),
    ).toThrow('1 MB');
  });

  it('normalizes stock executions in the documented Activity Flex CSV profile', () => {
    const header =
      '"AssetClass","LevelOfDetail","Buy/Sell","TradeDate","Symbol","ISIN","CurrencyPrimary","Quantity","TradePrice","IBCommission","IBCommissionCurrency","TradeID","Taxes","OrigTradeID"';
    const sell =
      '"STK","EXECUTION","SELL","20250108","AAPL","US0378331005","USD","-3.5","125.01","-0.35","USD","70011","0",""';
    const result = parseImportCsv(
      Buffer.from(
        [
          header,
          sell,
          sell.replace('STK', 'OPT'),
          sell.replace('"-0.35","USD"', '"-0.35","EUR"'),
          sell.replace('"70011","0",""', '"70012","0","70011"'),
        ].join('\n'),
      ),
      'IBKR_FLEX',
    );
    expect(result.rows).toMatchObject([
      {
        error: null,
        data: {
          type: 'SELL',
          occurredOn: '2025-01-08',
          isin: 'US0378331005',
          quantity: '3.5',
          commission: '0.35',
          externalId: '70011',
        },
      },
      { error: expect.stringContaining('STK'), data: null },
      { error: expect.stringContaining('Prowizja'), data: null },
      { error: expect.stringContaining('Korekta'), data: null },
    ]);
  });
});
