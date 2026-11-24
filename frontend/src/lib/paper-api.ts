import { apiRequest } from "./api-client";
import { parseInvestmentInstrument } from "./investments-api";
import {
  marketArray,
  marketBoolean,
  marketDecimal,
  marketNullableDecimal,
  marketObject,
  marketText,
} from "./investment-market-api";

const root = "/investment-paper/connections";
const path = (id: string) => `${root}/${encodeURIComponent(id)}`;
const orderPath = (id: string, orderId: string) =>
  `${path(id)}/orders/${encodeURIComponent(orderId)}`;
const post = (path: string, body: unknown) =>
  apiRequest<unknown>(path, { method: "POST", body: JSON.stringify(body) });

function cash(value: unknown) {
  const row = marketObject(value);
  return { PLN: marketDecimal(row.PLN), USD: marketDecimal(row.USD) };
}

function connection(value: unknown) {
  const row = marketObject(value);
  return {
    id: marketText(row.id),
    name: marketText(row.name),
    reconciliationRequired: marketBoolean(row.reconciliationRequired),
  };
}

function signal(value: unknown) {
  const row = marketObject(value);
  return {
    id: marketText(row.id),
    validUntil: marketText(row.validUntil),
    side: marketText(row.side),
    instrument: parseInvestmentInstrument(row.instrument),
  };
}

function order(value: unknown) {
  const row = marketObject(value);
  return {
    id: marketText(row.id),
    clientOrderId: marketText(row.clientOrderId),
    signalId: row.signalId === null ? null : marketText(row.signalId),
    instrument: parseInvestmentInstrument(row.instrument),
    side: marketText(row.side),
    type: marketText(row.type),
    state: marketText(row.state),
    quantity: marketDecimal(row.quantity),
    filledQuantity: marketDecimal(row.filledQuantity),
    limitPrice: marketNullableDecimal(row.limitPrice),
    events: marketArray(row.events, (value) => {
      const event = marketObject(value);
      return {
        id: marketText(event.externalEventId),
        kind: marketText(event.kind),
        happenedAt: marketText(event.happenedAt),
      };
    }),
    fills: marketArray(row.fills, (value) => {
      const fill = marketObject(value);
      return {
        id: marketText(fill.executionId),
        quantity: marketDecimal(fill.quantity),
        price: marketDecimal(fill.price),
        fee: marketDecimal(fill.fee),
      };
    }),
  };
}

function reconciliation(value: unknown) {
  if (value === null) return null;
  const row = marketObject(value);
  const result = marketObject(row.result);
  const difference =
    result.differences == null ? null : marketObject(result.differences);
  const local = result.local == null ? null : marketObject(result.local);
  return {
    matched: marketBoolean(row.matched),
    createdAt: marketText(row.createdAt),
    available: local ? cash(local.available) : null,
    error: typeof result.error === "string" ? result.error : null,
    differences: difference
      ? {
          openOrders: marketArray(difference.openOrders, marketText),
          fills: marketArray(difference.fills, marketText),
          amounts: ["cash", "available", "positions"].flatMap((type) =>
            marketArray(difference[type], (value) => {
              const item = marketObject(value);
              return {
                type,
                key: marketText(item.key),
                recorded: marketDecimal(item.recorded),
                observed: marketDecimal(item.observed),
              };
            }),
          ),
        }
      : null,
  };
}

function account(value: unknown) {
  const row = marketObject(value);
  return {
    ...connection(row),
    cash: cash(marketObject(row.balances).cash),
    positions: marketArray(row.positions, (value) => ({
      ...parseInvestmentInstrument(value),
      quantity: marketDecimal(marketObject(value).quantity),
    })),
    orders: marketArray(row.orders, order),
    reconciliation: reconciliation(row.lastReconciliation),
  };
}

export type PaperOrder = ReturnType<typeof order>;
export type PaperSignal = ReturnType<typeof signal>;
export type PaperFault =
  "NONE" | "BEFORE_RECEIPT" | "AFTER_RECEIPT" | "SESSION_EXPIRED";
export type PaperAction = "FILL" | "REJECTED" | "CANCELLED";

export const paperApi = {
  list: async (abort: AbortSignal) =>
    marketArray(await apiRequest<unknown>(root, { signal: abort }), connection),
  signal: async (id: string, abort: AbortSignal) =>
    signal(
      await apiRequest<unknown>(`${root}/signals/${encodeURIComponent(id)}`, {
        signal: abort,
      }),
    ),
  account: async (id: string, abort: AbortSignal) =>
    account(await apiRequest<unknown>(path(id), { signal: abort })),
  create: async (body: {
    name: string;
    openingOn: string;
    cash: { PLN: string; USD: string };
    idempotencyKey: string;
  }) => connection(await post(root, body)),
  order: async (
    id: string,
    body: {
      instrumentId: string;
      side: string;
      type: string;
      quantity: string;
      limitPrice?: string;
      signalId?: string;
      idempotencyKey: string;
    },
  ) => order(await post(`${path(id)}/orders`, body)),
  submit: async (id: string, orderId: string, fault: PaperFault) => {
    const row = marketObject(
      await post(`${orderPath(id, orderId)}/submit`, { fault }),
    );
    return {
      state: marketText(row.state),
      sessionExpired: row.sessionExpired === true,
    };
  },
  simulate: (
    id: string,
    orderId: string,
    body: {
      kind: PaperAction;
      idempotencyKey: string;
      fill?: { quantity: string; price: string; fee: string };
    },
  ) => post(`${orderPath(id, orderId)}/simulate`, body),
  reconcile: (id: string) => post(`${path(id)}/reconcile`, {}),
};
