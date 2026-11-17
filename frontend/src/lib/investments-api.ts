import { ApiError, apiRequest } from "./api-client";
import { isCalendarDate } from "./transaction-input";

export type InvestmentPortfolio = { id: string; name: string };
export type InvestmentAccount = InvestmentPortfolio & {
  portfolioId: string;
  archivedAt: string | null;
};
export type InvestmentInstrument = {
  id: string;
  ticker: string;
  mic: string;
  currency: "PLN" | "USD";
};
export type InvestmentEvent = {
  id: string;
  accountId: string;
  type: string;
  occurredOn: string;
  daySequence: number;
  revision: number;
  effective: boolean;
  timePrecision: "DATE" | "INSTANT";
  executedAt: string | null;
  sourceTimeZone: string | null;
  marketSessionOn: string | null;
  settledOn: string | null;
  cashEntries: { kind: string; currency: string; amount: string }[];
  trade: {
    instrument: InvestmentInstrument;
    quantity: string;
    unitPrice: string;
    grossAmount: string;
  } | null;
  correctionReason: string | null;
};
export type InvestmentHistory = {
  items: InvestmentEvent[];
  total: number;
  page: number;
  pageSize: number;
};
export type InvestmentSummary = {
  cash: { PLN: string; USD: string };
  positions: {
    instrumentId: string;
    currency: string;
    quantity: string;
    cost: string;
  }[];
  sales: { eventId: string; currency: string; result: string }[];
  instruments: InvestmentInstrument[];
};
export type InvestmentQuery = {
  page: number;
  type?: string;
  from?: string;
  to?: string;
};
export type ManualInvestmentInput = {
  type: "DEPOSIT" | "BUY" | "SELL";
  idempotencyKey: string;
  occurredOn: string;
  timePrecision: "DATE" | "INSTANT";
  executedAt?: string;
  sourceTimeZone?: string;
  marketSessionOn?: string;
  settledOn?: string;
  daySequence: number;
  currency?: "PLN" | "USD";
  amount?: string;
  instrumentId?: string;
  quantity?: string;
  unitPrice?: string;
  commission?: string;
};

function invalid(): never {
  throw new ApiError(
    502,
    "Serwer zwrócił nieprawidłowe dane inwestycji. Spróbuj ponownie.",
  );
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  return typeof value === "string" ? value : invalid();
}
function id(value: unknown): string {
  const text = string(value);
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(text)
    ? text
    : invalid();
}
function decimal(value: unknown): string {
  const text = string(value);
  return /^-?\d{1,40}(?:\.\d{1,10})?$/.test(text) ? text : invalid();
}
function integer(value: unknown, min = 0): number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= min
    ? value
    : invalid();
}
function array<T>(value: unknown, parse: (item: unknown) => T): T[] {
  return Array.isArray(value) ? value.map(parse) : invalid();
}
function currency(value: unknown): "PLN" | "USD" {
  return value === "PLN" || value === "USD" ? value : invalid();
}
function portfolio(value: unknown): InvestmentPortfolio {
  const v = object(value);
  return { id: id(v.id), name: string(v.name) };
}
function account(value: unknown): InvestmentAccount {
  const v = object(value);
  if (
    v.archivedAt !== null &&
    (typeof v.archivedAt !== "string" ||
      !Number.isFinite(Date.parse(v.archivedAt)))
  )
    invalid();
  return {
    ...portfolio(v),
    portfolioId: id(v.portfolioId),
    archivedAt: v.archivedAt as string | null,
  };
}
function instrument(value: unknown): InvestmentInstrument {
  const v = object(value);
  return {
    id: id(v.id),
    ticker: string(v.ticker),
    mic: string(v.mic),
    currency: currency(v.currency),
  };
}
function event(value: unknown): InvestmentEvent {
  const v = object(value);
  if (
    !isCalendarDate(v.occurredOn) ||
    typeof v.effective !== "boolean" ||
    !["DATE", "INSTANT"].includes(String(v.timePrecision))
  )
    invalid();
  const t = v.trade === null ? null : object(v.trade);
  return {
    id: id(v.id),
    accountId: id(v.accountId),
    type: string(v.type),
    occurredOn: v.occurredOn as string,
    daySequence: integer(v.daySequence, 1),
    revision: integer(v.revision),
    effective: v.effective as boolean,
    timePrecision: v.timePrecision as "DATE" | "INSTANT",
    executedAt: v.executedAt === null ? null : string(v.executedAt),
    sourceTimeZone: v.sourceTimeZone === null ? null : string(v.sourceTimeZone),
    marketSessionOn:
      v.marketSessionOn === null ? null : string(v.marketSessionOn),
    settledOn: v.settledOn === null ? null : string(v.settledOn),
    correctionReason:
      v.correctionReason === null ? null : string(v.correctionReason),
    cashEntries: array(v.cashEntries, (entry) => {
      const e = object(entry);
      return {
        kind: string(e.kind),
        currency: currency(e.currency),
        amount: decimal(e.amount),
      };
    }),
    trade: t
      ? {
          instrument: instrument(t.instrument),
          quantity: decimal(t.quantity),
          unitPrice: decimal(t.unitPrice),
          grossAmount: decimal(t.grossAmount),
        }
      : null,
  };
}
function history(value: unknown): InvestmentHistory {
  const v = object(value);
  return {
    items: array(v.items, event),
    total: integer(v.total),
    page: integer(v.page, 1),
    pageSize: integer(v.pageSize, 1),
  };
}
function summary(value: unknown): InvestmentSummary {
  const v = object(value);
  const cash = object(v.cash);
  return {
    cash: { PLN: decimal(cash.PLN), USD: decimal(cash.USD) },
    instruments: array(v.instruments, instrument),
    positions: array(v.positions, (entry) => {
      const e = object(entry);
      return {
        instrumentId: id(e.instrumentId),
        currency: currency(e.currency),
        quantity: decimal(e.quantity),
        cost: decimal(e.cost),
      };
    }),
    sales: array(v.sales, (entry) => {
      const e = object(entry);
      return {
        eventId: id(e.eventId),
        currency: currency(e.currency),
        result: decimal(e.result),
      };
    }),
  };
}
function acknowledgement(value: unknown) {
  const v = object(value);
  return { eventId: id(v.eventId), revision: integer(v.revision) };
}
const root = "/investments/portfolios";
export const investmentAccountPath = (portfolioId: string, accountId: string) =>
  `${root}/${encodeURIComponent(portfolioId)}/accounts/${encodeURIComponent(accountId)}`;
const write = (
  path: string,
  data: unknown,
  method = "POST",
  signal?: AbortSignal,
) => apiRequest<unknown>(path, { method, signal, body: JSON.stringify(data) });

export const investmentsApi = {
  portfolios: async (signal?: AbortSignal) =>
    array(await apiRequest<unknown>(root, { signal }), portfolio),
  portfolio: async (portfolioId: string, signal?: AbortSignal) =>
    portfolio(
      await apiRequest<unknown>(`${root}/${encodeURIComponent(portfolioId)}`, {
        signal,
      }),
    ),
  createPortfolio: async (name: string) =>
    portfolio(await write(root, { name })),
  accounts: async (portfolioId: string, signal?: AbortSignal) =>
    array(
      await apiRequest<unknown>(
        `${root}/${encodeURIComponent(portfolioId)}/accounts`,
        { signal },
      ),
      account,
    ),
  createAccount: async (portfolioId: string, name: string) =>
    account(
      await write(`${root}/${encodeURIComponent(portfolioId)}/accounts`, {
        name,
      }),
    ),
  account: async (p: string, a: string, signal?: AbortSignal) =>
    account(await apiRequest<unknown>(investmentAccountPath(p, a), { signal })),
  updateAccount: async (
    p: string,
    a: string,
    input: { name?: string; archived?: boolean },
  ) => account(await write(investmentAccountPath(p, a), input, "PATCH")),
  instruments: async (signal?: AbortSignal) =>
    array(
      await apiRequest<unknown>("/investments/instruments", { signal }),
      instrument,
    ),
  summary: async (p: string, a: string, signal?: AbortSignal) =>
    summary(
      await apiRequest<unknown>(`${investmentAccountPath(p, a)}/summary`, {
        signal,
      }),
    ),
  history: async (
    p: string,
    a: string,
    query: InvestmentQuery,
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query))
      if (value) params.set(key, String(value));
    return history(
      await apiRequest<unknown>(
        `${investmentAccountPath(p, a)}/events?${params}`,
        { signal },
      ),
    );
  },
  post: async (
    p: string,
    a: string,
    input: ManualInvestmentInput,
    signal?: AbortSignal,
  ) =>
    acknowledgement(
      await write(
        `${investmentAccountPath(p, a)}/events`,
        input,
        "POST",
        signal,
      ),
    ),
  correct: async (
    p: string,
    a: string,
    eventId: string,
    input: {
      expectedRevision: number;
      reason: string;
      idempotencyKey: string;
      replacement: ManualInvestmentInput;
    },
    signal?: AbortSignal,
  ) =>
    acknowledgement(
      await write(
        `${investmentAccountPath(p, a)}/events/${encodeURIComponent(eventId)}/corrections`,
        input,
        "POST",
        signal,
      ),
    ),
};
