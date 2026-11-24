import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { InvestmentAccountsService } from '../investments/accounts.service.js';
import { eventInclude } from '../investments/events.service.js';
import { formatInvestmentSourceInstant } from '../investments/timing.js';
import { zonedClock } from '../market-data/calendar.js';
import { PortfolioValuationService } from '../portfolio-analytics/valuation.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { encodeCsv } from './csv-writer.js';

export const investmentExportKinds = [
  'operations',
  'positions',
  'results',
  'audit',
] as const;
export type InvestmentExportKind = (typeof investmentExportKinds)[number];
const day = (value: Date | null) => value?.toISOString().slice(0, 10) ?? '';
const rangeColumns = ['accountId', 'asOf'];
const operationColumns = [
  'type',
  'occurredOn',
  'currency',
  'amount',
  'ticker',
  'mic',
  'isin',
  'quantity',
  'unitPrice',
  'commission',
  'grossAmount',
  'withholdingTax',
  'fee',
  'totalCost',
  'acquiredOn',
  'soldCurrency',
  'boughtCurrency',
  'soldAmount',
  'boughtAmount',
  'numerator',
  'denominator',
  'externalId',
  'executedAt',
  'sourceTimeZone',
  'marketSessionOn',
  'settledOn',
  'daySequence',
  'source',
  'sourceKey',
  'originalExternalId',
  'from',
  ...rangeColumns,
];
const auditColumns = [
  ...operationColumns,
  'effective',
  'revision',
  'correctionOfId',
  'correctionReason',
  'recordedAt',
];
const positionColumns = [
  ...rangeColumns,
  'ticker',
  'mic',
  'isin',
  'currency',
  'quantity',
  'cost',
  'quoteStatus',
  'quoteSource',
  'quoteSessionOn',
  'close',
  'value',
  'valuePLN',
  'unrealized',
];
const resultColumns = [
  ...rangeColumns,
  'scope',
  'currency',
  'cash',
  'realized',
  'dividendsGross',
  'feesAndTaxes',
  'value',
  'knownValue',
  'netContributions',
  'result',
  'complete',
];
type Event = Prisma.InvestmentEventGetPayload<{ include: typeof eventInclude }>;

function eventRow(
  event: Event,
  accountId: string,
  asOf: string,
  from: string | undefined,
) {
  const instrument =
    event.trade?.instrument ??
    event.openingLot?.instrument ??
    event.split?.instrument;
  const cash = (kind: string) =>
    event.cashEntries.find((entry) => entry.kind === kind);
  const cashValue = (kind: string) => cash(kind)?.amount.abs().toFixed(2);
  const sold = event.cashEntries.find(
    (entry) => entry.kind === 'FX' && entry.amount.isNegative(),
  );
  const bought = event.cashEntries.find(
    (entry) => entry.kind === 'FX' && entry.amount.isPositive(),
  );
  const transfer =
    cash('EXTERNAL_TRANSFER') ??
    (event.type === 'FEE' ? cash('FEE') : undefined);
  const dividend = cash('DIVIDEND_GROSS');
  return {
    accountId,
    asOf,
    from,
    type: event.type,
    occurredOn: day(event.occurredOn),
    externalId: event.id,
    source: event.source,
    sourceKey: event.sourceKey,
    originalExternalId: event.externalOperationId,
    executedAt:
      event.executedAt && event.sourceTimeZone
        ? formatInvestmentSourceInstant(event.executedAt, event.sourceTimeZone)
        : '',
    sourceTimeZone: event.sourceTimeZone,
    marketSessionOn: day(event.marketSessionOn),
    settledOn: day(event.settledOn),
    daySequence: String(event.daySequence),
    revision: String(event.revision),
    effective: String(event.activeSlot === 1),
    correctionOfId: event.correctionOfId,
    correctionReason: event.correctionReason,
    recordedAt: event.recordedAt.toISOString(),
    currency: instrument?.currency ?? transfer?.currency ?? dividend?.currency,
    ticker: instrument?.ticker,
    mic: instrument?.mic,
    isin: instrument?.isin,
    amount: transfer?.amount.abs().toFixed(2),
    quantity: (event.trade?.quantity ?? event.openingLot?.quantity)?.toFixed(
      10,
    ),
    unitPrice: event.trade?.unitPrice.toFixed(10),
    commission: cashValue('COMMISSION'),
    grossAmount: dividend?.amount.toFixed(2),
    withholdingTax: cashValue('WITHHOLDING_TAX'),
    fee: dividend ? cashValue('FEE') : undefined,
    totalCost: event.openingLot?.totalCost.toFixed(8),
    acquiredOn: day(event.openingLot?.acquiredOn ?? null),
    soldCurrency: sold?.currency,
    boughtCurrency: bought?.currency,
    soldAmount: sold?.amount.abs().toFixed(2),
    boughtAmount: bought?.amount.toFixed(2),
    numerator: event.split?.numerator.toFixed(10),
    denominator: event.split?.denominator.toFixed(10),
  };
}

@Injectable()
export class InvestmentExportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: InvestmentAccountsService,
    private readonly valuation: PortfolioValuationService,
  ) {}

  async csv(
    userId: string,
    portfolioId: string,
    accountId: string,
    kind: InvestmentExportKind,
    asOf: string,
    from?: string,
  ) {
    if (
      (from && from > asOf) ||
      asOf > zonedClock(new Date(), 'Europe/Warsaw').day
    )
      throw new BadRequestException('Podaj zakres do bieżącej daty.');
    if (kind === 'operations' || kind === 'audit') {
      await this.accounts.getAccount(userId, portfolioId, accountId);
      const events = await this.prisma.investmentEvent.findMany({
        where: {
          accountId,
          account: { portfolioId, portfolio: { userId } },
          occurredOn: {
            lte: new Date(asOf + 'T00:00:00Z'),
            ...(from ? { gte: new Date(from + 'T00:00:00Z') } : {}),
          },
          ...(kind === 'operations'
            ? { activeSlot: 1, type: { not: 'CORRECTION' } }
            : {}),
        },
        include: eventInclude,
        orderBy: [
          { occurredOn: 'asc' },
          { daySequence: 'asc' },
          { revision: 'asc' },
          { id: 'asc' },
        ],
      });
      return encodeCsv(
        kind === 'operations' ? operationColumns : auditColumns,
        events.map((event) => eventRow(event, accountId, asOf, from)),
      );
    }
    const data = await this.valuation.load(
      userId,
      portfolioId,
      asOf,
      undefined,
      accountId,
    );
    const result = this.valuation.calculate(data, asOf, undefined, {
      allowMissingCalendar: true,
    });
    const context = { accountId, asOf };
    if (kind === 'positions') {
      const instruments = new Map(
        data.instruments.map((item) => [item.id, item]),
      );
      return encodeCsv(
        positionColumns,
        result.positions.map((row) => ({
          ...context,
          ...row.instrument,
          isin: instruments.get(row.instrument.id)?.isin,
          quantity: row.quantity,
          cost: row.cost,
          quoteStatus: row.status,
          quoteSource: row.quote?.source,
          quoteSessionOn: row.quote?.sessionOn,
          close: row.quote?.close,
          value: row.value,
          valuePLN: row.valuePln,
          unrealized: row.unrealized,
        })),
      );
    }
    return encodeCsv(resultColumns, [
      ...(['PLN', 'USD'] as const).map((currency) => ({
        ...context,
        scope: 'currency',
        currency,
        cash: result.cash[currency],
        realized: result.realized[currency],
        dividendsGross: result.dividendsGross[currency],
        feesAndTaxes: result.feesAndTaxes[currency],
      })),
      {
        ...context,
        scope: 'total',
        currency: 'PLN',
        complete: String(result.complete),
        value: result.valuePln,
        knownValue: result.knownValuePln,
        netContributions: result.netContributionsPln,
        result: result.resultPln,
      },
    ]);
  }
}
