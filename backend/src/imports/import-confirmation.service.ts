import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type { InvestmentCurrency, Prisma } from '../generated/prisma/client.js';
import { replayFifo, type FifoEvent } from '../investments/fifo.js';
import {
  preparePosting,
  replayBalances,
  type PreparedPosting,
} from '../investments/posting.js';
import { splitOnDate } from '../investments/split-reconciliation.js';
import { InvestmentCalculation as D } from '../investments/precision.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ConfirmImportDto } from './confirm-import.dto.js';
import { lockImportAccount } from './import-account.js';
import { csvOperation } from './import-parser.js';
import {
  csvSourceKey,
  ImportPreviewService,
} from './import-preview.service.js';

const sha256 = (payload: string) =>
  createHash('sha256').update(payload).digest('hex');
const day = (date: Date) => date.toISOString().slice(0, 10);
const historyInclude = {
  cashEntries: true,
  securityEntries: true,
  split: true,
  trade: { include: { instrument: { select: { currency: true } } } },
  openingLot: { include: { instrument: { select: { currency: true } } } },
} satisfies Prisma.InvestmentEventInclude;

type Candidate = { id: string; posting: PreparedPosting };
function asReplay({ id, posting }: Candidate, currency?: InvestmentCurrency) {
  return {
    ...posting.timing,
    id,
    type: posting.type,
    orderingSource: 'EXPLICIT' as const,
    split: posting.split,
    trade: posting.trade
      ? { ...posting.trade, instrument: { currency: currency! } }
      : null,
    openingLot: posting.openingLot
      ? { ...posting.openingLot, instrument: { currency: currency! } }
      : null,
    cashEntries: posting.cashEntries,
    securityEntries: posting.securityEntries,
  } satisfies FifoEvent;
}

function checkOpening(
  events: (FifoEvent & Parameters<typeof replayBalances>[0][number])[],
  input: ConfirmImportDto,
) {
  if (input.completeHistory) return;
  if (!input.openingOn || input.openingOn > input.asOf)
    throw new BadRequestException(
      'Podaj datę stanu otwarcia dla niepełnej historii.',
    );
  const opening = events.filter(
    (event) => day(event.occurredOn) <= input.openingOn!,
  );
  if (input.openingEmpty) {
    const state = replayBalances(opening);
    if (
      [...Object.values(state.cash), ...Object.values(state.securities)].some(
        (value) => !new D(value).isZero(),
      )
    )
      throw new ConflictException(
        'Rachunek zawiera niezerowy stan w dniu otwarcia.',
      );
    return;
  }
  if (
    !opening.some(
      (event) =>
        day(event.occurredOn) === input.openingOn &&
        (event.type === 'OPENING_POSITION' || event.type === 'DEPOSIT'),
    )
  )
    throw new ConflictException(
      'Dodaj na datę otwarcia partie z kosztem i datą nabycia lub saldo początkowe gotówki.',
    );
}

async function persist(tx: Prisma.TransactionClient, operations: Candidate[]) {
  if (!operations.length) return;
  await tx.investmentEvent.createMany({
    data: operations.map(({ id, posting }) => ({
      id,
      accountId: posting.accountId,
      type: posting.type,
      source: posting.source,
      sourceKey: posting.sourceKey,
      externalOperationId: posting.externalOperationId,
      idempotencyKey: posting.idempotencyKey,
      recordedBy: posting.recordedBy,
      payloadHash: sha256(
        JSON.stringify({ ...posting, idempotencyKey: undefined }),
      ),
      fxRatePlnPerUsd: posting.fxRatePlnPerUsd,
      ...posting.timing,
    })),
  });
  const trades = operations.flatMap(({ id, posting }) =>
    posting.trade ? [{ eventId: id, ...posting.trade }] : [],
  );
  const lots = operations.flatMap(({ id, posting }) =>
    posting.openingLot ? [{ eventId: id, ...posting.openingLot }] : [],
  );
  const splits = operations.flatMap(({ id, posting }) =>
    posting.split ? [{ eventId: id, ...posting.split }] : [],
  );
  const cash = operations.flatMap(({ id, posting }) =>
    posting.cashEntries.map((entry) => ({ eventId: id, ...entry })),
  );
  const shares = operations.flatMap(({ id, posting }) =>
    posting.securityEntries.map((entry) => ({ eventId: id, ...entry })),
  );
  if (trades.length) await tx.trade.createMany({ data: trades });
  if (lots.length) await tx.openingLot.createMany({ data: lots });
  if (splits.length) await tx.investmentSplit.createMany({ data: splits });
  if (cash.length) await tx.cashEntry.createMany({ data: cash });
  if (shares.length) await tx.securityEntry.createMany({ data: shares });
}

function reconciliation(
  input: ConfirmImportDto,
  state: ReturnType<typeof replayBalances>,
) {
  const diff = (expected: string, actual: string) => {
    const amount = new D(actual).minus(expected);
    return amount.isZero()
      ? null
      : { expected, actual, difference: amount.toFixed() };
  };
  const cash = (['PLN', 'USD'] as const).flatMap((currency) => {
    const difference = diff(input.cash[currency], state.cash[currency]);
    return difference ? [{ currency, ...difference }] : [];
  });
  const broker = new Map(
    input.positions.map(({ instrumentId, quantity }) => [
      instrumentId,
      quantity,
    ]),
  );
  const positions = [
    ...new Set([...broker.keys(), ...Object.keys(state.securities)]),
  ]
    .sort()
    .flatMap((instrumentId) => {
      const difference = diff(
        broker.get(instrumentId) ?? '0',
        state.securities[instrumentId] ?? '0',
      );
      return difference ? [{ instrumentId, ...difference }] : [];
    });
  return { asOf: input.asOf, cash, positions };
}

@Injectable()
export class ImportConfirmationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly preview: ImportPreviewService,
  ) {}

  confirm(
    userId: string,
    portfolioId: string,
    accountId: string,
    id: string,
    input: ConfirmImportDto,
  ) {
    const decisions = new Map(
      input.decisions.map(({ number, action }) => [number, action]),
    );
    const positionIds = [
      ...new Set(input.positions.map(({ instrumentId }) => instrumentId)),
    ];
    if (
      decisions.size !== input.decisions.length ||
      positionIds.length !== input.positions.length
    )
      throw new BadRequestException(
        'Decyzja i pozycja mogą wystąpić tylko raz.',
      );
    const requestHash = sha256(
      JSON.stringify({
        completeHistory: input.completeHistory,
        openingOn: input.openingOn ?? null,
        openingEmpty: input.openingEmpty ?? false,
        asOf: input.asOf,
        cash: [
          new D(input.cash.PLN).toFixed(2),
          new D(input.cash.USD).toFixed(2),
        ],
        positions: [...input.positions]
          .sort((a, b) => a.instrumentId.localeCompare(b.instrumentId))
          .map((row) => [row.instrumentId, new D(row.quantity).toFixed(10)]),
        decisions: [...decisions].sort(([a], [b]) => a - b),
      }),
    );
    return this.prisma.$transaction(
      async (tx) => {
        const account = await lockImportAccount(
          tx,
          userId,
          portfolioId,
          accountId,
        );
        const batch = await this.preview.inspect(
          tx,
          userId,
          portfolioId,
          accountId,
          id,
        );
        if (batch.status === 'CONFIRMED') {
          if (batch.confirmationHash !== requestHash)
            throw new ConflictException(
              'Partia była już zatwierdzona z innymi danymi.',
            );
          return batch.confirmation;
        }
        if (account.archivedAt)
          throw new ConflictException('Rachunek jest zarchiwizowany.');
        if (batch.status !== 'PARSED' || batch.rows.length !== batch.rowCount)
          throw new ConflictException(
            'Popraw błędne wiersze i wczytaj plik ponownie.',
          );
        const possible = new Set(
          batch.rows
            .filter((row) => row.duplicate === 'POSSIBLE')
            .map((row) => row.number),
        );
        if (
          [...possible].some((number) => !decisions.has(number)) ||
          [...decisions.keys()].some((number) => !possible.has(number))
        )
          throw new ConflictException(
            'Sprawdź i rozstrzygnij aktualne ostrzeżenia o duplikatach.',
          );
        if (
          positionIds.length &&
          (await tx.instrument.count({
            where: { id: { in: positionIds } },
          })) !== positionIds.length
        )
          throw new BadRequestException(
            'Dokument brokera zawiera nieznany instrument.',
          );
        const history = await tx.investmentEvent.findMany({
          where: { accountId, activeSlot: 1 },
          include: historyInclude,
        });
        const sequences = new Map<string, number>();
        for (const event of history) {
          const on = day(event.occurredOn);
          sequences.set(
            on,
            Math.max(event.daySequence, sequences.get(on) ?? 0),
          );
        }
        const skipped: number[] = [];
        const operations: Candidate[] = [];
        const replay: (FifoEvent &
          Parameters<typeof replayBalances>[0][number])[] = [...history];
        for (const row of batch.rows) {
          if (
            row.mappingError ||
            row.duplicate === 'REPEATED_EXTERNAL_ID' ||
            (row.duplicate === 'ALREADY_IMPORTED' && !row.exact)
          )
            throw new ConflictException(
              `Wiersz ${row.number} wymaga sprawdzenia mapowania lub identyfikatora.`,
            );
          if (row.exact || decisions.get(row.number) === 'SKIP') {
            skipped.push(row.number);
            continue;
          }
          const on = row.data.occurredOn;
          if (on > input.asOf)
            throw new BadRequestException(
              `Data dokumentu brokera poprzedza wiersz ${row.number}.`,
            );
          if (
            !input.completeHistory &&
            input.openingOn &&
            on <= input.openingOn &&
            !['DEPOSIT', 'OPENING_POSITION'].includes(row.data.type)
          )
            throw new BadRequestException(
              `Wiersz ${row.number} musi następować po dacie otwarcia.`,
            );
          const sequence = (sequences.get(on) ?? 0) + 1;
          sequences.set(on, sequence);
          const key = `csv:${id}:${row.number}`;
          const posting = preparePosting(
            userId,
            {
              ...csvOperation(
                accountId,
                row.data,
                sequence,
                row.instrument?.id,
              ),
              idempotencyKey: key,
              source: 'IMPORT',
              sourceKey: csvSourceKey(batch.format),
              externalOperationId: row.data.externalId ?? key,
            },
            row.instrument?.currency,
          );
          const split = posting.split;
          if (
            split &&
            history.some(
              (entry) =>
                entry.corporateActionId &&
                splitOnDate(
                  entry,
                  split.instrumentId,
                  posting.timing.occurredOn,
                ),
            )
          )
            throw new ConflictException(
              `Split z wiersza ${row.number} jest już odnotowany jako zdarzenie korporacyjne.`,
            );
          const candidate = { id: randomUUID(), posting };
          operations.push(candidate);
          replay.push(asReplay(candidate, row.instrument?.currency));
        }
        checkOpening(replay, input);
        replayBalances(replay);
        replayFifo(replay);
        const broker = reconciliation(
          input,
          replayBalances(
            replay.filter((event) => day(event.occurredOn) <= input.asOf),
          ),
        );
        await persist(tx, operations);
        const confirmation = {
          posted: operations.length,
          skipped,
          reconciliation: broker,
        };
        await tx.importBatch.update({
          where: { id },
          data: {
            status: 'CONFIRMED',
            confirmedAt: new Date(),
            confirmationHash: requestHash,
            confirmation,
          },
        });
        return confirmation;
      },
      { timeout: 30000 },
    );
  }
}
