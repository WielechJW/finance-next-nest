import { BadRequestException } from '@nestjs/common';
import type { InvestmentCurrency } from '../generated/prisma/client.js';
import {
  manualEventTypes,
  type CreateInvestmentEventDto,
} from '../investments/dto/event.dto.js';
import { toInvestmentInput } from '../investments/event-input.js';
import { preparePosting } from '../investments/posting.js';
import { parseInvestmentCalendarDate } from '../investments/timing.js';
import { readCsv } from './csv-reader.js';

export const importFormats = ['GENERIC', 'IBKR_FLEX'] as const;
export type ImportFormat = (typeof importFormats)[number];
const genericHeaders = ['type', 'occurredon'];
const ibkrFields = [
  'assetclass',
  'levelofdetail',
  'buy/sell',
  'tradedate',
  'symbol',
  'isin',
  'currencyprimary',
  'quantity',
  'tradeprice',
  'ibcommission',
  'ibcommissioncurrency',
  'tradeid',
];
const decimalFields = [
  'amount',
  'quantity',
  'unitPrice',
  'commission',
  'grossAmount',
  'withholdingTax',
  'fee',
  'totalCost',
  'soldAmount',
  'boughtAmount',
  'numerator',
  'denominator',
];
const dateFields = ['settledOn', 'marketSessionOn', 'acquiredOn'];
const currencyFields = ['currency', 'soldCurrency', 'boughtCurrency'];

type Cells = Map<string, string>;
type InputRow = {
  fields: Record<string, string>;
  ticker?: string;
  mic?: string;
  isin?: string;
  externalId?: string;
};
const get = (row: Cells, key: string) =>
  row.get(key.toLowerCase()) || undefined;

function date(input: string) {
  const iso = input
    .replace(/^(\d{2})\.(\d{2})\.(\d{4})$/, '$3-$2-$1')
    .replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
  parseInvestmentCalendarDate(iso, 'data');
  return iso;
}

function decimal(input: string) {
  if (!/^-?\d+(?:[.,]\d+)?$/.test(input) || input.length > 40) {
    throw new Error('Nieprawidłowa liczba dziesiętna.');
  }
  return input
    .replace(',', '.')
    .replace(/^(-?)0+(?=\d)/, '$1')
    .replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
}

function dollarsOrZloty(input: string): InvestmentCurrency {
  const code = input.toUpperCase();
  if (code !== 'PLN' && code !== 'USD')
    throw new Error('Obsługiwane waluty to PLN i USD.');
  return code;
}

function generic(row: Cells): InputRow {
  const fields: Record<string, string> = {
    type: get(row, 'type')?.toUpperCase() ?? '',
    occurredOn: date(get(row, 'occurredOn') ?? ''),
  };
  for (const key of [
    ...dateFields,
    ...currencyFields,
    ...decimalFields,
    'executedAt',
    'sourceTimeZone',
  ]) {
    const input = get(row, key);
    if (input) fields[key] = input;
  }
  return {
    fields,
    ticker: get(row, 'ticker'),
    mic: get(row, 'mic'),
    isin: get(row, 'isin'),
    externalId: get(row, 'externalId'),
  };
}

function ibkr(row: Cells): InputRow {
  if (
    get(row, 'assetclass') !== 'STK' ||
    get(row, 'levelofdetail') !== 'EXECUTION'
  ) {
    throw new Error(
      'Wybierz wykonania transakcji na akcjach (STK / EXECUTION).',
    );
  }
  const type = get(row, 'buy/sell');
  if (type !== 'BUY' && type !== 'SELL')
    throw new Error('Wykonanie musi mieć kierunek BUY lub SELL.');
  const quantity = decimal(get(row, 'quantity') ?? '');
  if (quantity.startsWith('-') && type !== 'SELL')
    throw new Error('Kupno ma ujemną ilość.');
  const currency = dollarsOrZloty(get(row, 'currencyprimary') ?? '');
  const commission = decimal(get(row, 'ibcommission') ?? '');
  const commissionCurrency = get(row, 'ibcommissioncurrency');
  if (
    commission !== '0' &&
    (commissionCurrency !== currency || !commission.startsWith('-'))
  ) {
    throw new Error('Prowizja musi być obciążeniem w walucie transakcji.');
  }
  const tax = get(row, 'taxes');
  if (tax && !/^[-+]?0+(?:[.,]0+)?$/.test(tax))
    throw new Error('Wykonanie zawiera oddzielny podatek.');
  if (get(row, 'origtradeid') || get(row, 'originaltradeid'))
    throw new Error('Korekta wykonania wymaga ręcznego przeglądu.');
  const externalId = get(row, 'tradeid');
  if (!externalId) throw new Error('Brak Trade ID.');
  const tradeDate = date(get(row, 'tradedate') ?? '');
  const fields = {
    type,
    currency,
    occurredOn: tradeDate,
    marketSessionOn: tradeDate,
    quantity: quantity.replace(/^-/, ''),
    unitPrice: get(row, 'tradeprice') ?? '',
    commission: commission.replace(/^-/, ''),
  };
  return {
    fields,
    ticker: get(row, 'symbol'),
    isin: get(row, 'isin'),
    externalId,
  };
}

function normalize(
  { fields, ticker, mic, isin, externalId }: InputRow,
  number: number,
) {
  const type = manualEventTypes.find((value) => value === fields.type);
  if (!type) throw new Error('Nieobsługiwany typ operacji.');
  const instrumentEvent = requiresInstrument(type);
  if (instrumentEvent && !ticker && !isin)
    throw new Error('Podaj ticker lub ISIN instrumentu.');
  if (ticker && !/^[A-Z0-9][A-Z0-9.\-_/ ]{0,31}$/i.test(ticker))
    throw new Error('Nieprawidłowy ticker.');
  if (mic && !/^[A-Z0-9]{4}$/i.test(mic))
    throw new Error('Nieprawidłowy kod MIC.');
  if (isin && !/^[A-Z]{2}[A-Z0-9]{9}\d$/i.test(isin))
    throw new Error('Nieprawidłowy ISIN.');
  if (externalId && externalId.length > 128)
    throw new Error('Identyfikator zewnętrzny jest za długi.');
  for (const key of dateFields)
    if (fields[key]) fields[key] = date(fields[key]);
  for (const key of decimalFields)
    if (fields[key] !== undefined) fields[key] = decimal(fields[key]);
  for (const key of currencyFields)
    if (fields[key]) fields[key] = dollarsOrZloty(fields[key]);
  const instrumentCurrency = instrumentEvent
    ? dollarsOrZloty(fields.currency ?? '')
    : undefined;
  preparePosting(
    'csv-validation',
    csvOperation(
      'csv-validation',
      fields,
      number,
      instrumentEvent ? 'pending-mapping' : undefined,
    ),
    instrumentCurrency,
  );
  return {
    ...fields,
    ...(ticker ? { ticker: ticker.toUpperCase() } : {}),
    ...(mic ? { mic: mic.toUpperCase() } : {}),
    ...(isin ? { isin: isin.toUpperCase() } : {}),
    ...(externalId ? { externalId } : {}),
  };
}

export function requiresInstrument(type: string) {
  return ['BUY', 'SELL', 'SPLIT', 'OPENING_POSITION'].includes(type);
}

export function csvOperation(
  accountId: string,
  data: Record<string, string>,
  daySequence: number,
  instrumentId?: string,
) {
  const {
    ticker: _ticker,
    mic: _mic,
    isin: _isin,
    externalId: _externalId,
    ...fields
  } = data;
  const type = manualEventTypes.find((value) => value === fields.type);
  if (!type) throw new BadRequestException('Nieobsługiwany typ operacji.');
  const instrumentEvent = requiresInstrument(type);
  if (instrumentEvent) delete fields.currency;
  const dto = {
    ...fields,
    type,
    occurredOn: fields.occurredOn,
    daySequence,
    idempotencyKey: 'csv-validation',
    timePrecision: fields.executedAt ? 'INSTANT' : 'DATE',
    ...(instrumentEvent && instrumentId ? { instrumentId } : {}),
  } satisfies CreateInvestmentEventDto;
  return toInvestmentInput(accountId, dto);
}

export function parseImportCsv(buffer: Buffer, format: ImportFormat) {
  const { encoding, separator, rows } = readCsv(
    buffer,
    format === 'IBKR_FLEX' ? ibkrFields : genericHeaders,
  );
  return {
    encoding,
    separator,
    rows: rows.map(({ number, values }) => {
      try {
        if (!values)
          throw new BadRequestException(
            'Wiersz ma złą liczbę pól, uszkodzone cudzysłowy lub przekracza 4096 znaków.',
          );
        return {
          number,
          data: normalize(
            format === 'IBKR_FLEX' ? ibkr(values) : generic(values),
            number,
          ),
          error: null,
        };
      } catch (error) {
        // Messages come from the row and posting validators and omit raw cell values.
        return {
          number,
          data: null,
          error: error instanceof Error ? error.message : 'Niepoprawny wiersz.',
        };
      }
    }),
  };
}
