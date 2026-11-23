import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import {
  preparePosting,
  type PreparedPosting,
} from '../investments/posting.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { lockImportAccount } from './import-account.js';
import {
  csvOperation,
  requiresInstrument,
  type ImportFormat,
} from './import-parser.js';

const instrumentSelect = {
  id: true,
  ticker: true,
  mic: true,
  isin: true,
  currency: true,
  name: true,
};
type Instrument = Prisma.InstrumentGetPayload<{
  select: typeof instrumentSelect;
}>;
export const csvSourceKey = (format: ImportFormat) =>
  format === 'IBKR_FLEX' ? 'csv:ibkr-flex' : 'csv:generic';
const cashFields = [
  'amount',
  'quantity',
  'unitPrice',
  'commission',
  'grossAmount',
  'withholdingTax',
  'fee',
  'soldAmount',
  'boughtAmount',
  'totalCost',
  'numerator',
  'denominator',
];
const day = (date: Date) => date.toISOString().slice(0, 10);

export function importRowData(
  value: Prisma.JsonValue,
): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!Object.values(value).every((entry) => typeof entry === 'string'))
    return null;
  return value as Record<string, string>;
}

export function importBatchWhere(
  userId: string,
  portfolioId: string,
  accountId: string,
  id: string,
) {
  return {
    id,
    accountId,
    authorId: userId,
    account: { portfolioId, portfolio: { userId } },
  };
}

function hasInstrument(data: Record<string, string>) {
  return (
    requiresInstrument(data.type) ||
    (data.type === 'DIVIDEND' && !!(data.ticker || data.isin))
  );
}

function indexBy(candidates: Instrument[], field: 'ticker' | 'isin') {
  const index = new Map<string, Instrument[]>();
  for (const candidate of candidates) {
    const key = candidate[field];
    if (!key) continue;
    const group = index.get(key) ?? [];
    group.push(candidate);
    index.set(key, group);
  }
  return index;
}

function instrumentMatch(data: Record<string, string>, matches: Instrument[]) {
  const identified = matches.filter(
    (instrument) =>
      (!data.ticker || instrument.ticker === data.ticker) &&
      (!data.mic || instrument.mic === data.mic) &&
      (!data.isin || instrument.isin === data.isin),
  );
  if (!identified.length)
    return {
      instrument: null,
      mappingError: 'Nie znaleziono instrumentu pasującego do identyfikatorów.',
    };
  const inCurrency = identified.filter(
    (instrument) => instrument.currency === data.currency,
  );
  if (!inCurrency.length)
    return {
      instrument: null,
      mappingError: 'Waluta operacji różni się od waluty instrumentu.',
    };
  if (inCurrency.length > 1)
    return {
      instrument: null,
      mappingError:
        'Kilka instrumentów pasuje do wiersza. Wybierz właściwe notowanie.',
    };
  return { instrument: inCurrency[0], mappingError: null };
}

export const ledgerInclude = {
  trade: true,
  openingLot: true,
  split: true,
  cashEntries: true,
} satisfies Prisma.InvestmentEventInclude;
type LedgerRow = Prisma.InvestmentEventGetPayload<{
  include: typeof ledgerInclude;
}>;

export function ledgerFingerprint(value: PreparedPosting | LedgerRow) {
  const occurredOn =
    'timing' in value ? value.timing.occurredOn : value.occurredOn;
  const cash = value.cashEntries
    .map((entry) =>
      [
        entry.kind,
        entry.currency,
        new Prisma.Decimal(entry.amount).toFixed(2),
      ].join(':'),
    )
    .sort();
  const trade = value.trade && [
    value.trade.instrumentId,
    new Prisma.Decimal(value.trade.quantity).toFixed(10),
    new Prisma.Decimal(value.trade.unitPrice).toFixed(10),
  ];
  const opening = value.openingLot && [
    value.openingLot.instrumentId,
    new Prisma.Decimal(value.openingLot.quantity).toFixed(10),
    new Prisma.Decimal(value.openingLot.totalCost).toFixed(8),
    day(value.openingLot.acquiredOn),
  ];
  const split = value.split && [
    value.split.instrumentId,
    new Prisma.Decimal(value.split.numerator).toFixed(10),
    new Prisma.Decimal(value.split.denominator).toFixed(10),
  ];
  return JSON.stringify([
    day(occurredOn),
    value.type,
    cash,
    trade ?? null,
    opening ?? null,
    split ?? null,
  ]);
}

@Injectable()
export class ImportPreviewService {
  constructor(private readonly prisma: PrismaService) {}

  preview(userId: string, portfolioId: string, accountId: string, id: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const { rows } = await this.inspect(
          tx,
          userId,
          portfolioId,
          accountId,
          id,
        );
        return rows.map(
          ({ data: _privateOperation, exact: _alreadyExact, ...row }) => row,
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async inspect(
    tx: Prisma.TransactionClient,
    userId: string,
    portfolioId: string,
    accountId: string,
    id: string,
  ) {
    const batch = await tx.importBatch.findFirst({
      where: importBatchWhere(userId, portfolioId, accountId, id),
      select: {
        format: true,
        status: true,
        confirmationHash: true,
        confirmation: true,
        rows: {
          select: { number: true, data: true, mappedInstrumentId: true },
          orderBy: { number: 'asc' },
        },
      },
    });
    if (!batch) throw new NotFoundException('Nie znaleziono partii importu.');
    const rows = batch.rows.flatMap((row) => {
      const data = importRowData(row.data);
      return data ? [{ ...row, data }] : [];
    });
    const unique = (values: (string | null | undefined)[]) => [
      ...new Set(values.filter((value): value is string => !!value)),
    ];
    const dates = unique(rows.map(({ data }) => data.occurredOn)).map(
      (date) => new Date(date + 'T00:00:00Z'),
    );
    const externalIds = unique(rows.map(({ data }) => data.externalId));
    const sourceKey = csvSourceKey(batch.format);
    const instruments = await tx.instrument.findMany({
      where: {
        OR: [
          { ticker: { in: unique(rows.map(({ data }) => data.ticker)) } },
          { isin: { in: unique(rows.map(({ data }) => data.isin)) } },
          { id: { in: unique(rows.map((row) => row.mappedInstrumentId)) } },
        ],
      },
      select: instrumentSelect,
    });
    const candidates = await tx.investmentEvent.findMany({
      where: {
        accountId,
        OR: [
          { activeSlot: 1, occurredOn: { in: dates } },
          {
            source: 'IMPORT',
            sourceKey,
            externalOperationId: { in: externalIds },
          },
        ],
      },
      include: ledgerInclude,
    });
    const knownIds = new Map(
      candidates
        .filter(
          ({ source, sourceKey: key }) =>
            source === 'IMPORT' && key === sourceKey,
        )
        .flatMap((event) =>
          event.externalOperationId
            ? [[event.externalOperationId, event] as const]
            : [],
        ),
    );
    const ledger = new Set(
      candidates
        .filter(({ activeSlot }) => activeSlot === 1)
        .map(ledgerFingerprint),
    );
    const byTicker = indexBy(instruments, 'ticker');
    const byIsin = indexBy(instruments, 'isin');
    const byId = new Map(
      instruments.map((instrument) => [instrument.id, instrument]),
    );
    const counts = new Map<string, number>();
    for (const { data } of rows)
      if (data.externalId)
        counts.set(data.externalId, (counts.get(data.externalId) ?? 0) + 1);
    const preview = rows.map(({ number, data, mappedInstrumentId }) => {
      const selected = mappedInstrumentId
        ? byId.get(mappedInstrumentId)
        : undefined;
      const matches = data.isin
        ? byIsin.get(data.isin)
        : byTicker.get(data.ticker);
      const mapping =
        selected && selected.currency === data.currency
          ? { instrument: selected, mappingError: null }
          : hasInstrument(data)
            ? instrumentMatch(data, matches ?? [])
            : { instrument: null, mappingError: null };
      let duplicate:
        'ALREADY_IMPORTED' | 'REPEATED_EXTERNAL_ID' | 'POSSIBLE' | null = null;
      const known = data.externalId ? knownIds.get(data.externalId) : undefined;
      if (known) duplicate = 'ALREADY_IMPORTED';
      else if (data.externalId && (counts.get(data.externalId) ?? 0) > 1)
        duplicate = 'REPEATED_EXTERNAL_ID';
      const posting = !mapping.mappingError
        ? preparePosting(
            userId,
            csvOperation(accountId, data, number, mapping.instrument?.id),
            mapping.instrument?.currency,
          )
        : null;
      if (!duplicate && posting && ledger.has(ledgerFingerprint(posting)))
        duplicate = 'POSSIBLE';
      const exact =
        !!known &&
        !!posting &&
        ledgerFingerprint(known) === ledgerFingerprint(posting) &&
        known.sourceTimeZone === posting.timing.sourceTimeZone &&
        known.executedAt?.toISOString() ===
          posting.timing.executedAt?.toISOString() &&
        known.marketSessionOn?.toISOString() ===
          posting.timing.marketSessionOn?.toISOString() &&
        known.settledOn?.toISOString() ===
          posting.timing.settledOn?.toISOString();
      return {
        number,
        data,
        exact,
        ...mapping,
        duplicate,
        needsInstrument: hasInstrument(data),
        details: Object.fromEntries(
          Object.entries(data).filter(
            ([key]) =>
              cashFields.includes(key) ||
              key.endsWith('Currency') ||
              key === 'currency',
          ),
        ),
      };
    });
    return { ...batch, rowCount: batch.rows.length, rows: preview };
  }

  async map(
    userId: string,
    portfolioId: string,
    accountId: string,
    id: string,
    number: number,
    instrumentId: string | null,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const account = await lockImportAccount(
        tx,
        userId,
        portfolioId,
        accountId,
      );
      const row = await tx.importRow.findFirst({
        where: {
          batchId: id,
          number,
          batch: importBatchWhere(userId, portfolioId, accountId, id),
        },
        select: {
          data: true,
          batch: { select: { status: true } },
        },
      });
      if (!row) throw new NotFoundException('Nie znaleziono wiersza partii.');
      if (row.batch.status === 'CONFIRMED')
        throw new ConflictException('Partia została już zatwierdzona.');
      if (account.archivedAt)
        throw new ConflictException('Rachunek jest zarchiwizowany.');
      const data = importRowData(row.data);
      if (!data || !hasInstrument(data))
        throw new BadRequestException(
          'Wiersz nie wymaga mapowania instrumentu.',
        );
      if (instrumentId) {
        const instrument = await tx.instrument.findUnique({
          where: { id: instrumentId },
          select: { currency: true },
        });
        if (!instrument || instrument.currency !== data.currency)
          throw new BadRequestException(
            'Wybierz instrument w walucie operacji.',
          );
      }
      const updated = await tx.importRow.updateMany({
        where: {
          batchId: id,
          number,
          batch: importBatchWhere(userId, portfolioId, accountId, id),
        },
        data: { mappedInstrumentId: instrumentId },
      });
      if (!updated.count)
        throw new NotFoundException('Nie znaleziono wiersza partii.');
    });
  }
}
