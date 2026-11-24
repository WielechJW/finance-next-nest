import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type PaperOrderState } from '../generated/prisma/client.js';
import {
  preparePosting,
  replayBalances,
  type ReplayEvent,
} from '../investments/posting.js';
import { InvestmentCalculation as D } from '../investments/precision.js';
import { zonedClock } from '../market-data/calendar.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  assertFillTiming,
  lockPaperAccount,
  paperDecimal,
  paperHash,
  projectPaperOrder,
} from './paper-domain.js';
import type { PaperEventDto, SimulatePaperEventDto } from './paper.dto.js';
import { PaperService } from './paper.service.js';

export type SubmissionFault =
  'NONE' | 'BEFORE_RECEIPT' | 'AFTER_RECEIPT' | 'SESSION_EXPIRED';
const detail = {
  instrument: { select: { currency: true } },
  fills: { select: { executionId: true } },
  venue: {
    include: {
      events: { orderBy: [{ occurredAt: 'asc' }, { eventKey: 'asc' }] },
    },
  },
} satisfies Prisma.OrderInclude;
type VenueAwareOrder = Prisma.OrderGetPayload<{ include: typeof detail }>;
const active = new Set<PaperOrderState>([
  'SENT',
  'ACCEPTED',
  'PARTIALLY_FILLED',
  'UNKNOWN',
]);
const readStored = (value: Prisma.JsonValue) =>
  value as unknown as PaperEventDto;

function normalized(input: PaperEventDto): PaperEventDto {
  if (
    (input.kind === 'FILL') !== !!input.fill ||
    new Date(input.happenedAt) > new Date()
  )
    throw new BadRequestException('Nieprawidłowe zdarzenie symulatora.');
  const fill = input.fill;
  return {
    externalEventId: input.externalEventId,
    kind: input.kind,
    happenedAt: new Date(input.happenedAt).toISOString(),
    ...(fill
      ? {
          fill: {
            executionId: fill.executionId,
            daySequence: fill.daySequence,
            quantity: paperDecimal(fill.quantity, 'quantity'),
            price: paperDecimal(fill.price, 'unitPrice'),
            fee: paperDecimal(fill.fee, 'amount8'),
          },
        }
      : {}),
  };
}

async function saveVenueEvent(
  tx: Prisma.TransactionClient,
  venueOrderId: string,
  body: PaperEventDto,
) {
  const payload = normalized(body);
  const payloadHash = paperHash(payload);
  const key = { venueOrderId, eventKey: payload.externalEventId };
  const existing = await tx.paperVenueEvent.findUnique({
    where: { venueOrderId_eventKey: key },
  });
  if (existing) {
    if (existing.payloadHash !== payloadHash)
      throw new ConflictException(
        'Identyfikator zdarzenia symulatora jest zajęty.',
      );
    return;
  }
  await tx.paperVenueEvent.create({
    data: {
      ...key,
      occurredAt: new Date(payload.happenedAt),
      payload: {
        externalEventId: payload.externalEventId,
        kind: payload.kind,
        happenedAt: payload.happenedAt,
        ...(payload.fill
          ? {
              fill: {
                executionId: payload.fill.executionId,
                quantity: payload.fill.quantity,
                price: payload.fill.price,
                fee: payload.fill.fee,
                daySequence: payload.fill.daySequence,
              },
            }
          : {}),
      },
      payloadHash,
    },
  });
}

function venueProjection(order: VenueAwareOrder) {
  const events = (order.venue?.events ?? []).map(({ payload }) =>
    readStored(payload),
  );
  const seen = new Map<string, { payload: PaperEventDto; hash: string }>();
  let quantity = new D(0);
  for (const payload of events) {
    if (!payload.fill) continue;
    const hash = paperHash([payload.happenedAt, payload.fill]);
    const previous = seen.get(payload.fill.executionId);
    if (previous && previous.hash !== hash)
      throw new ConflictException('Symulator ma sprzeczne dane wykonania.');
    if (!previous) {
      quantity = quantity.plus(payload.fill.quantity);
      seen.set(payload.fill.executionId, { payload, hash });
    }
  }
  if (quantity.gt(order.quantity.toFixed()))
    throw new ConflictException('Symulator potwierdził nadmiarowe wykonanie.');
  const states = events.map(({ kind, happenedAt }) => ({
    kind,
    happenedAt: new Date(happenedAt),
  }));
  return {
    quantity: quantity.toFixed(10),
    events,
    fills: [...seen.values()].map(({ payload }) => payload),
    state: projectPaperOrder(
      order.quantity.toFixed(),
      quantity.toFixed(),
      states,
    ),
  };
}

function venueLedgerEvent(
  userId: string,
  accountId: string,
  order: VenueAwareOrder,
  input: PaperEventDto,
): ReplayEvent {
  const fill = input.fill!;
  const executedAt = new Date(input.happenedAt);
  const posting = preparePosting(
    userId,
    {
      accountId,
      occurredOn: zonedClock(executedAt, 'Europe/Warsaw').day,
      executedAt: input.happenedAt,
      sourceTimeZone: 'UTC',
      timePrecision: 'INSTANT',
      daySequence: fill.daySequence,
      idempotencyKey: fill.executionId,
      type: order.side,
      instrumentId: order.instrumentId,
      quantity: fill.quantity,
      unitPrice: fill.price,
      commission: fill.fee,
    },
    order.instrument.currency,
  );
  return {
    ...posting.timing,
    type: posting.type,
    orderingSource: 'EXPLICIT',
    cashEntries: posting.cashEntries,
    securityEntries: posting.securityEntries,
  };
}

type Balance = ReturnType<typeof replayBalances>;
type ActiveOrder = {
  clientOrderId: string;
  state: PaperOrderState;
  filled: string;
  order: VenueAwareOrder;
};
function available(balance: Balance, orders: ActiveOrder[]) {
  const result = { PLN: new D(balance.cash.PLN), USD: new D(balance.cash.USD) };
  for (const { order, filled } of orders) {
    if (order.side !== 'BUY' || !order.limitPrice) continue;
    const reserve = new D(order.quantity.toFixed())
      .minus(filled)
      .times(order.limitPrice.toFixed());
    result[order.instrument.currency] =
      result[order.instrument.currency].minus(reserve);
  }
  return { PLN: result.PLN.toFixed(2), USD: result.USD.toFixed(2) };
}

function amounts(local: Record<string, string>, venue: Record<string, string>) {
  return [...new Set([...Object.keys(local), ...Object.keys(venue)])]
    .sort()
    .flatMap((key) => {
      const recorded = local[key] ?? '0';
      const observed = venue[key] ?? '0';
      return new D(recorded).eq(observed) ? [] : [{ key, recorded, observed }];
    });
}

@Injectable()
export class PaperExecutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paper: PaperService,
  ) {}

  async submit(
    userId: string,
    connectionId: string,
    orderId: string,
    fault: SubmissionFault,
  ) {
    const claim = await this.prisma.$transaction(async (tx) => {
      const connection = await lockPaperAccount(tx, userId, connectionId);
      const order = await tx.order.findUnique({
        where: { id_connectionId: { id: orderId, connectionId } },
        select: {
          id: true,
          state: true,
          clientOrderId: true,
          signal: { select: { validUntil: true } },
        },
      });
      if (!order)
        throw new NotFoundException('Nie znaleziono zlecenia symulowanego.');
      if (connection.reconciliationRequired || order.state === 'UNKNOWN')
        throw new ConflictException('Najpierw uzgodnij rachunek symulowany.');
      if (order.state !== 'INTENT')
        return {
          state: order.state,
          clientOrderId: order.clientOrderId,
          repeat: true,
        };
      const now = new Date();
      if (order.signal && order.signal.validUntil <= now)
        throw new ConflictException('Sygnał wygasł przed wysłaniem zlecenia.');
      if (fault === 'SESSION_EXPIRED')
        return {
          state: order.state,
          clientOrderId: order.clientOrderId,
          repeat: true,
        };
      const sentAt = now.toISOString();
      await this.paper.recordInTransaction(tx, userId, connectionId, orderId, {
        externalEventId: `sent:${order.clientOrderId}`,
        happenedAt: sentAt,
        kind: 'SENT',
      });
      await tx.brokerConnection.update({
        where: { id: connectionId },
        data: { reconciliationRequired: true },
      });
      return { ...order, repeat: false };
    });
    if (claim.repeat)
      return {
        clientOrderId: claim.clientOrderId,
        state: claim.state,
        ...(fault === 'SESSION_EXPIRED' && claim.state === 'INTENT'
          ? { sessionExpired: true }
          : {}),
      };

    try {
      if (fault !== 'BEFORE_RECEIPT') {
        await this.prisma.$transaction(async (tx) => {
          await lockPaperAccount(tx, userId, connectionId);
          const venue = await tx.paperVenueOrder.upsert({
            where: { clientOrderId: claim.clientOrderId },
            update: {},
            create: {
              orderId,
              clientOrderId: claim.clientOrderId,
              acceptedAt: new Date(),
            },
          });
          await saveVenueEvent(tx, venue.id, {
            externalEventId: `accepted:${claim.clientOrderId}`,
            happenedAt: venue.acceptedAt.toISOString(),
            kind: 'ACCEPTED',
          });
        });
      }
      if (fault === 'NONE') {
        const checked = await this.reconcile(userId, connectionId);
        if (checked.matched)
          return { clientOrderId: claim.clientOrderId, state: 'ACCEPTED' };
      }
    } catch {
      // The receipt can have reached the venue before a transport or process error.
    }
    const observed =
      fault === 'AFTER_RECEIPT'
        ? null
        : await this.lookup(userId, connectionId, claim.clientOrderId);
    if (observed?.found) {
      const reconciled = await this.reconcile(userId, connectionId);
      return {
        clientOrderId: claim.clientOrderId,
        state: observed.venueState,
        reconciliationRequired: !reconciled.matched,
      };
    }
    await this.prisma.$transaction(async (tx) => {
      await lockPaperAccount(tx, userId, connectionId);
      await tx.order.updateMany({
        where: { id: orderId, connectionId, state: 'SENT' },
        data: { state: 'UNKNOWN' },
      });
    });
    return {
      clientOrderId: claim.clientOrderId,
      state: 'UNKNOWN',
      foundAtVenue: observed?.found ?? null,
    };
  }

  async lookup(userId: string, connectionId: string, clientOrderId: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        connectionId,
        clientOrderId,
        connection: {
          userId,
          mode: 'LOCAL_PAPER',
          account: { portfolio: { userId, mode: 'PAPER' } },
        },
      },
      include: detail,
    });
    if (!order)
      throw new NotFoundException('Nie znaleziono identyfikatora zlecenia.');
    const status = venueProjection(order);
    return {
      clientOrderId,
      found: !!order.venue,
      venueState: order.venue ? status.state : null,
      fillIds: status.fills.map((entry) => entry.fill!.executionId),
    };
  }

  simulate(
    userId: string,
    connectionId: string,
    orderId: string,
    action: SimulatePaperEventDto,
  ) {
    if ((action.kind === 'FILL') !== !!action.fill)
      throw new BadRequestException('Podaj szczegóły wyłącznie dla wykonania.');
    const externalEventId = `simulation:${action.idempotencyKey}`;
    const fill = action.fill && {
      quantity: paperDecimal(action.fill.quantity, 'quantity'),
      price: paperDecimal(action.fill.price, 'unitPrice'),
      fee: paperDecimal(action.fill.fee, 'amount8'),
    };
    return this.prisma.$transaction(
      async (tx) => {
        const connection = await lockPaperAccount(tx, userId, connectionId);
        const order = await tx.order.findUnique({
          where: { id_connectionId: { id: orderId, connectionId } },
          include: detail,
        });
        if (!order?.venue)
          throw new NotFoundException('Zlecenie nie dotarło do symulatora.');
        const { venue } = order;
        const existing = venue.events.find(
          (event) => event.eventKey === externalEventId,
        );
        if (existing) {
          const payload = readStored(existing.payload);
          const previous = payload.fill;
          if (
            payload.kind !== action.kind ||
            paperHash(fill ?? null) !==
              paperHash(
                previous
                  ? {
                      quantity: previous.quantity,
                      price: previous.price,
                      fee: previous.fee,
                    }
                  : null,
              )
          )
            throw new ConflictException('Powtórzona akcja ma inną treść.');
          return { recorded: true };
        }
        if (connection.reconciliationRequired)
          throw new ConflictException('Najpierw uzgodnij rachunek symulowany.');
        if (
          order.state !== 'ACCEPTED' &&
          (order.state !== 'PARTIALLY_FILLED' || action.kind === 'REJECTED')
        )
          throw new ConflictException(
            'Akcja jest niedostępna w tym stanie zlecenia.',
          );
        const now = new Date();
        const day = zonedClock(now, 'Europe/Warsaw').day;
        const sequence = fill
          ? (
              await tx.investmentEvent.aggregate({
                where: {
                  accountId: connection.accountId,
                  occurredOn: new Date(day),
                  activeSlot: 1,
                },
                _max: { daySequence: true },
              })
            )._max.daySequence
          : null;
        const event: PaperEventDto = {
          kind: action.kind,
          happenedAt: now.toISOString(),
          externalEventId,
          ...(fill
            ? {
                fill: {
                  ...fill,
                  executionId: externalEventId,
                  daySequence: Math.max(sequence ?? 0, 2) + 1,
                },
              }
            : {}),
        };
        await saveVenueEvent(tx, venue.id, event);
        await this.paper.recordInTransaction(
          tx,
          userId,
          connectionId,
          orderId,
          event,
        );
        await tx.brokerConnection.update({
          where: { id: connectionId },
          data: { reconciliationRequired: true },
        });
        return { recorded: true };
      },
      { timeout: 30000 },
    );
  }

  async venueEvent(
    userId: string,
    connectionId: string,
    orderId: string,
    body: PaperEventDto,
  ) {
    if (!['FILL', 'REJECTED', 'CANCELLED'].includes(body.kind))
      throw new BadRequestException(
        'Wybierz wykonanie, odrzucenie albo anulowanie.',
      );
    await this.prisma.$transaction(async (tx) => {
      await lockPaperAccount(tx, userId, connectionId);
      const order = await tx.order.findUnique({
        where: { id_connectionId: { id: orderId, connectionId } },
        include: detail,
      });
      if (!order?.venue)
        throw new NotFoundException(
          'Zlecenie nie jest zapisane po stronie symulatora.',
        );
      const existing = venueProjection(order);
      const event = normalized(body);
      assertFillTiming(
        existing.events.map(({ kind, happenedAt }) => ({
          kind,
          happenedAt: new Date(happenedAt),
        })),
        event.kind,
        new Date(event.happenedAt),
        existing.fills.map(({ happenedAt }) => ({
          executedAt: new Date(happenedAt),
        })),
      );
      await saveVenueEvent(tx, order.venue.id, event);
      await tx.brokerConnection.update({
        where: { id: connectionId },
        data: { reconciliationRequired: true },
      });
    });
    return { recorded: true };
  }

  async reconcile(userId: string, connectionId: string) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const { accountId } = await lockPaperAccount(
            tx,
            userId,
            connectionId,
          );
          const initial = await tx.order.findMany({
            where: { connectionId },
            include: detail,
          });
          const venueOrders = initial
            .filter((order) => order.venue)
            .map((order) => ({ order, venue: venueProjection(order) }));
          const actions = venueOrders.flatMap(({ order, venue }) =>
            venue.events.map((event) => ({ orderId: order.id, event })),
          );
          actions.sort(
            (a, b) =>
              a.event.happenedAt.localeCompare(b.event.happenedAt) ||
              (a.event.fill?.daySequence ?? 0) -
                (b.event.fill?.daySequence ?? 0),
          );
          for (const { orderId, event } of actions)
            await this.paper.recordInTransaction(
              tx,
              userId,
              connectionId,
              orderId,
              event,
            );
          const posted = await tx.investmentEvent.findMany({
            where: { accountId, activeSlot: 1 },
            include: { cashEntries: true, securityEntries: true, split: true },
          });
          const local = replayBalances(posted);
          const venue = replayBalances([
            ...posted.filter(
              (entry) =>
                entry.source === 'SYSTEM' &&
                entry.sourceKey === 'paper:opening',
            ),
            ...venueOrders.flatMap(({ order, venue: view }) =>
              view.fills.map((fill) =>
                venueLedgerEvent(userId, accountId, order, fill),
              ),
            ),
          ]);
          const after = await tx.order.findMany({
            where: { connectionId },
            include: detail,
          });
          const localActive = after
            .filter((order) => active.has(order.state))
            .map((order) => ({
              order,
              clientOrderId: order.clientOrderId,
              state: order.state,
              filled: order.filledQuantity.toFixed(10),
            }));
          const venueActive = venueOrders
            .filter(({ venue: view }) => active.has(view.state))
            .map(({ order, venue: view }) => ({
              order,
              clientOrderId: order.clientOrderId,
              state: view.state,
              filled: view.quantity,
            }));
          const sourceIds = new Set(
            venueOrders.flatMap(({ venue: view }) =>
              view.fills.map(({ fill }) => fill!.executionId),
            ),
          );
          const localIds = new Set(
            after.flatMap((order) =>
              order.fills.map((fill) => fill.executionId),
            ),
          );
          const open = (orders: ActiveOrder[]) =>
            orders.map(({ clientOrderId, state, filled }) => ({
              clientOrderId,
              state,
              filled,
            }));
          const stateKey = ({ state, filled }: ActiveOrder) =>
            state + ':' + filled;
          const localById = new Map(
            localActive.map((entry) => [entry.clientOrderId, stateKey(entry)]),
          );
          const venueById = new Map(
            venueActive.map((entry) => [entry.clientOrderId, stateKey(entry)]),
          );
          const localAvailable = available(local, localActive);
          const venueAvailable = available(venue, venueActive);
          const differences = {
            cash: amounts(local.cash, venue.cash),
            positions: amounts(local.securities, venue.securities),
            available: amounts(localAvailable, venueAvailable),
            openOrders: [...new Set([...localById.keys(), ...venueById.keys()])]
              .filter((id) => localById.get(id) !== venueById.get(id))
              .sort(),
            fills: [...new Set([...localIds, ...sourceIds])]
              .filter((id) => localIds.has(id) !== sourceIds.has(id))
              .sort(),
          };
          const matched = Object.values(differences).every(
            (rows) => rows.length === 0,
          );
          const result = {
            matched,
            differences,
            local: {
              ...local,
              available: localAvailable,
              openOrders: open(localActive),
              fillIds: [...localIds].sort(),
            },
            venue: {
              ...venue,
              available: venueAvailable,
              openOrders: open(venueActive),
              fillIds: [...sourceIds].sort(),
            },
          };
          await tx.brokerConnection.update({
            where: { id: connectionId },
            data: { reconciliationRequired: !matched },
          });
          await tx.paperReconciliation.create({
            data: { connectionId, matched, result },
          });
          return result;
        },
        { timeout: 30000 },
      );
    } catch (error) {
      if (
        !(error instanceof ConflictException) &&
        !(error instanceof BadRequestException)
      )
        throw error;
      return this.prisma.$transaction(async (tx) => {
        await lockPaperAccount(tx, userId, connectionId);
        const result = {
          matched: false,
          error:
            'Zdarzenia symulatora wymagają uzgodnienia przed zaksięgowaniem.',
        };
        await tx.brokerConnection.update({
          where: { id: connectionId },
          data: { reconciliationRequired: true },
        });
        await tx.paperReconciliation.create({
          data: { connectionId, matched: false, result },
        });
        return result;
      });
    }
  }
}
