import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { InvestmentPostingService } from '../investments/posting.service.js';
import { replayBalances } from '../investments/posting.js';
import { InvestmentCalculation as D } from '../investments/precision.js';
import { zonedClock } from '../market-data/calendar.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  assertFillTiming,
  lockPaperAccount,
  paperDay,
  paperDecimal,
  paperHash,
  projectPaperOrder,
} from './paper-domain.js';
import type {
  PaperConnectionDto,
  PaperEventDto,
  PaperOrderDto,
} from './paper.dto.js';

const connectionSelect = {
  id: true,
  name: true,
  mode: true,
  openingOn: true,
  createdAt: true,
} satisfies Prisma.BrokerConnectionSelect;
const orderInclude = {
  instrument: { select: { id: true, ticker: true, mic: true, currency: true } },
  events: { orderBy: [{ happenedAt: 'asc' }, { externalEventId: 'asc' }] },
  fills: { orderBy: [{ executedAt: 'asc' }, { daySequence: 'asc' }] },
} satisfies Prisma.OrderInclude;
type Order = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;
const exchanges = ['XWAR', 'XNAS', 'XNYS', 'XASE', 'ARCX'];

function serialize(order: Order) {
  return {
    id: order.id,
    clientOrderId: order.clientOrderId,
    side: order.side,
    type: order.type,
    state: order.state,
    quantity: order.quantity.toFixed(10),
    filledQuantity: order.filledQuantity.toFixed(10),
    limitPrice: order.limitPrice?.toFixed(10) ?? null,
    instrument: order.instrument,
    createdAt: order.createdAt,
    events: order.events.map(({ externalEventId, kind, happenedAt }) => ({
      externalEventId,
      kind,
      happenedAt,
    })),
    fills: order.fills.map(
      ({
        executionId,
        executedAt,
        daySequence,
        quantity,
        price,
        fee,
        ledgerEventId,
      }) => ({
        executionId,
        executedAt,
        daySequence,
        quantity: quantity.toFixed(10),
        price: price.toFixed(10),
        fee: fee.toFixed(2),
        ledgerEventId,
      }),
    ),
  };
}

@Injectable()
export class PaperService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: InvestmentPostingService,
  ) {}

  list(userId: string) {
    return this.prisma.brokerConnection.findMany({
      where: {
        userId,
        mode: 'LOCAL_PAPER',
        account: { portfolio: { userId, mode: 'PAPER' } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: connectionSelect,
    });
  }

  create(userId: string, input: PaperConnectionDto) {
    const cash = {
      PLN: paperDecimal(input.cash.PLN, 'amount8'),
      USD: paperDecimal(input.cash.USD, 'amount8'),
    };
    if (input.openingOn > zonedClock(new Date(), 'Europe/Warsaw').day)
      throw new BadRequestException(
        'Data otwarcia rachunku nie może być przyszła.',
      );
    const key = { userId, idempotencyKey: input.idempotencyKey };
    const payloadHash = paperHash([input.name, input.openingOn, cash]);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
        const existing = await tx.brokerConnection.findUnique({
          where: { userId_idempotencyKey: key },
          select: { ...connectionSelect, payloadHash: true },
        });
        if (existing) {
          if (existing.payloadHash !== payloadHash)
            throw new ConflictException(
              'Klucz otwarcia opisuje inny rachunek.',
            );
          const { payloadHash: _hash, ...connection } = existing;
          return connection;
        }
        const portfolio = await tx.portfolio.create({
          data: {
            userId,
            mode: 'PAPER',
            name: input.name,
            accounts: { create: { name: input.name } },
          },
          select: { accounts: { select: { id: true } } },
        });
        const accountId = portfolio.accounts[0].id;
        const connection = await tx.brokerConnection.create({
          data: {
            ...key,
            accountId,
            name: input.name,
            payloadHash,
            openingOn: new Date(input.openingOn + 'T00:00:00Z'),
          },
          select: connectionSelect,
        });
        for (const [index, currency] of (['PLN', 'USD'] as const).entries())
          if (!new D(cash[currency]).isZero()) {
            await this.posting.postInTransaction(tx, userId, {
              accountId,
              type: 'DEPOSIT',
              currency,
              amount: cash[currency],
              occurredOn: input.openingOn,
              daySequence: index + 1,
              timePrecision: 'DATE',
              source: 'SYSTEM',
              sourceKey: 'paper:opening',
              externalOperationId: currency,
              idempotencyKey: `paper:opening:${currency}`,
            });
          }
        return connection;
      },
      { timeout: 30000 },
    );
  }

  async detail(userId: string, connectionId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const connection = await tx.brokerConnection.findFirst({
          where: {
            id: connectionId,
            userId,
            mode: 'LOCAL_PAPER',
            account: { portfolio: { userId, mode: 'PAPER' } },
          },
          select: { ...connectionSelect, accountId: true },
        });
        if (!connection)
          throw new NotFoundException('Nie znaleziono rachunku symulowanego.');
        const ledger = await tx.investmentEvent.findMany({
          where: { accountId: connection.accountId, activeSlot: 1 },
          include: { cashEntries: true, securityEntries: true, split: true },
        });
        const orders = await tx.order.findMany({
          where: { connectionId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 100,
          include: orderInclude,
        });
        const { accountId: _privateLedger, ...visible } = connection;
        return {
          ...visible,
          balances: replayBalances(ledger),
          orders: orders.map(serialize),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  createOrder(userId: string, connectionId: string, input: PaperOrderDto) {
    const quantity = paperDecimal(input.quantity, 'quantity');
    const limitPrice =
      input.limitPrice == null
        ? null
        : paperDecimal(input.limitPrice, 'unitPrice');
    if ((input.type === 'LIMIT') !== (limitPrice !== null))
      throw new BadRequestException(
        'Podaj limit wyłącznie dla zlecenia z limitem.',
      );
    const content = {
      instrumentId: input.instrumentId,
      side: input.side,
      type: input.type,
      quantity,
      limitPrice,
    };
    const payloadHash = paperHash(content);
    const key = { connectionId, idempotencyKey: input.idempotencyKey };
    return this.prisma.$transaction(async (tx) => {
      await lockPaperAccount(tx, userId, connectionId);
      const existing = await tx.order.findUnique({
        where: { connectionId_idempotencyKey: key },
        include: orderInclude,
      });
      if (existing) {
        if (existing.payloadHash !== payloadHash)
          throw new ConflictException(
            'Klucz został już użyty dla innej intencji.',
          );
        return serialize(existing);
      }
      const instrument = await tx.instrument.findUnique({
        where: { id: input.instrumentId },
        select: { mic: true, currency: true },
      });
      if (
        !instrument ||
        !exchanges.includes(instrument.mic) ||
        instrument.currency !== (instrument.mic === 'XWAR' ? 'PLN' : 'USD')
      )
        throw new BadRequestException(
          'Wybierz obsługiwany instrument PL lub USA.',
        );
      return serialize(
        await tx.order.create({
          data: { ...content, ...key, payloadHash },
          include: orderInclude,
        }),
      );
    });
  }

  recordEvent(
    userId: string,
    connectionId: string,
    orderId: string,
    input: PaperEventDto,
  ) {
    if ((input.kind === 'FILL') !== !!input.fill)
      throw new BadRequestException(
        'Dane wykonania są wymagane tylko dla zdarzenia FILL.',
      );
    const happenedAt = new Date(input.happenedAt);
    const occurredOn = zonedClock(happenedAt, 'Europe/Warsaw').day;
    if (happenedAt > new Date())
      throw new BadRequestException(
        'Zdarzenie nie może pochodzić z przyszłości.',
      );
    const fill = input.fill
      ? {
          executionId: input.fill.executionId,
          daySequence: input.fill.daySequence,
          quantity: paperDecimal(input.fill.quantity, 'quantity'),
          price: paperDecimal(input.fill.price, 'unitPrice'),
          fee: paperDecimal(input.fill.fee, 'amount8'),
        }
      : null;
    const payloadHash = paperHash([input.kind, happenedAt.toISOString(), fill]);
    return this.prisma.$transaction(
      async (tx) => {
        const locked = await lockPaperAccount(tx, userId, connectionId);
        const order = await tx.order.findUnique({
          where: { id_connectionId: { id: orderId, connectionId } },
          include: orderInclude,
        });
        if (!order)
          throw new NotFoundException('Nie znaleziono zlecenia symulowanego.');
        if (occurredOn < paperDay(locked.openingOn))
          throw new BadRequestException(
            'Zdarzenie poprzedza otwarcie rachunku symulowanego.',
          );
        const receipt = order.events.find(
          (item) => item.externalEventId === input.externalEventId,
        );
        if (receipt) {
          if (receipt.payloadHash !== payloadHash)
            throw new ConflictException(
              'Powtórzony identyfikator zdarzenia ma inną treść.',
            );
          return serialize(order);
        }
        assertFillTiming(order.events, input.kind, happenedAt, order.fills);
        let filled = new D(order.filledQuantity.toFixed());
        if (fill) {
          const old = await tx.fill.findUnique({
            where: {
              connectionId_executionId: {
                connectionId,
                executionId: fill.executionId,
              },
            },
          });
          if (
            old &&
            (old.orderId !== orderId || old.payloadHash !== payloadHash)
          )
            throw new ConflictException(
              'Identyfikator wykonania jest już przypisany do innych danych.',
            );
          if (!old) {
            filled = filled.plus(fill.quantity);
            if (filled.gt(order.quantity.toFixed()))
              throw new ConflictException(
                'Wykonania przekraczają ilość zlecenia.',
              );
            if (
              order.limitPrice &&
              (order.side === 'BUY'
                ? new D(fill.price).gt(order.limitPrice.toFixed())
                : new D(fill.price).lt(order.limitPrice.toFixed()))
            )
              throw new ConflictException(
                'Cena wykonania przekracza warunek zlecenia.',
              );
            const posted = await this.posting.postInTransaction(tx, userId, {
              type: order.side,
              accountId: locked.accountId,
              instrumentId: order.instrumentId,
              quantity: fill.quantity,
              unitPrice: fill.price,
              commission: fill.fee,
              occurredOn,
              executedAt: happenedAt.toISOString(),
              sourceTimeZone: 'UTC',
              timePrecision: 'INSTANT',
              daySequence: fill.daySequence,
              source: 'BROKER',
              sourceKey: 'paper:local',
              externalOperationId: fill.executionId,
              idempotencyKey: paperHash(['paper:local', fill.executionId]),
            });
            await tx.fill.create({
              data: {
                ...fill,
                orderId,
                connectionId,
                executedAt: happenedAt,
                ledgerEventId: posted.eventId,
                payloadHash,
              },
            });
          }
        }
        await tx.orderEvent.create({
          data: {
            orderId,
            externalEventId: input.externalEventId,
            kind: input.kind,
            happenedAt,
            payloadHash,
          },
        });
        const state = projectPaperOrder(
          order.quantity.toFixed(),
          filled.toFixed(),
          [...order.events, { kind: input.kind, happenedAt }],
        );
        return serialize(
          await tx.order.update({
            where: { id: orderId },
            data: { state, filledQuantity: filled.toFixed() },
            include: orderInclude,
          }),
        );
      },
      { timeout: 30000 },
    );
  }
}
