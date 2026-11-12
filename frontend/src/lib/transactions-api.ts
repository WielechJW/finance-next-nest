import { ApiError, apiRequest } from "./api-client";
import { isOpeningBalanceString } from "./money";
import { isCalendarDate } from "./transaction-input";
import type {
  CategoryDto,
  CreateTransactionInput,
  ListTransactionsInput,
  TransactionDto,
  TransactionListDto,
  TransactionType,
  UpdateTransactionInput,
} from "./transaction-types";

export function isTransactionType(value: unknown): value is TransactionType {
  return value === "INCOME" || value === "EXPENSE";
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length === 36 &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function parseCategory(value: unknown): CategoryDto {
  if (
    !value ||
    typeof value !== "object" ||
    !("id" in value) ||
    !isUuid(value.id) ||
    !("name" in value) ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    !("type" in value) ||
    !isTransactionType(value.type)
  ) {
    throw new ApiError(
      502,
      "Serwer zwrócił nieprawidłowe kategorie. Spróbuj ponownie.",
    );
  }
  return { id: value.id, name: value.name, type: value.type };
}

function parseTransaction(
  value: unknown,
  message = "Serwer zwrócił nieprawidłowe dane transakcji. Odśwież portfel, aby sprawdzić zapis.",
): TransactionDto {
  if (
    !value ||
    typeof value !== "object" ||
    !("id" in value) ||
    !isUuid(value.id) ||
    !("walletId" in value) ||
    !isUuid(value.walletId) ||
    !("type" in value) ||
    !isTransactionType(value.type) ||
    !("amount" in value) ||
    !isOpeningBalanceString(value.amount) ||
    value.amount.startsWith("-") ||
    value.amount === "0.00" ||
    !("categoryId" in value) ||
    !isUuid(value.categoryId) ||
    !("title" in value) ||
    typeof value.title !== "string" ||
    !value.title.trim() ||
    Array.from(value.title).length > 100 ||
    !("note" in value) ||
    !(
      value.note === null ||
      (typeof value.note === "string" && Array.from(value.note).length <= 1000)
    ) ||
    !("occurredOn" in value) ||
    !isCalendarDate(value.occurredOn) ||
    !("createdAt" in value) ||
    !isTimestamp(value.createdAt) ||
    !("updatedAt" in value) ||
    !isTimestamp(value.updatedAt)
  ) {
    throw new ApiError(502, message);
  }
  return {
    id: value.id,
    walletId: value.walletId,
    type: value.type,
    amount: value.amount,
    categoryId: value.categoryId,
    title: value.title,
    note: value.note,
    occurredOn: value.occurredOn,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export const transactionsApi = {
  async update(
    id: string,
    input: UpdateTransactionInput,
    signal?: AbortSignal,
  ): Promise<TransactionDto> {
    const transaction = parseTransaction(
      await apiRequest<unknown>(`/transactions/${encodeURIComponent(id)}`, {
        method: "PATCH",
        signal,
        body: JSON.stringify({
          type: input.type,
          amount: input.amount,
          categoryId: input.categoryId,
          title: input.title,
          occurredOn: input.occurredOn,
          note: input.note,
        }),
      }),
    );
    if (transaction.id !== id)
      throw new ApiError(
        502,
        "Serwer zwrócił inną transakcję. Odśwież historię, aby sprawdzić zapis.",
      );
    return transaction;
  },

  async remove(id: string, signal?: AbortSignal): Promise<void> {
    await apiRequest<void>(`/transactions/${encodeURIComponent(id)}`, {
      method: "DELETE",
      signal,
    });
  },

  async list(
    input: ListTransactionsInput = {},
    signal?: AbortSignal,
  ): Promise<TransactionListDto> {
    const params = new URLSearchParams();
    for (const key of [
      "type",
      "categoryId",
      "from",
      "to",
      "page",
      "pageSize",
    ] as const) {
      const value = input[key];
      if (value !== undefined) params.set(key, String(value));
    }
    const query = params.toString();
    const payload = await apiRequest<unknown>(
      "/transactions" + (query ? "?" + query : ""),
      { signal },
    );
    if (
      !payload ||
      typeof payload !== "object" ||
      !("items" in payload) ||
      !Array.isArray(payload.items) ||
      !("page" in payload) ||
      typeof payload.page !== "number" ||
      !Number.isSafeInteger(payload.page) ||
      payload.page < 1 ||
      payload.page > 2147483647 ||
      !("pageSize" in payload) ||
      typeof payload.pageSize !== "number" ||
      !Number.isSafeInteger(payload.pageSize) ||
      payload.pageSize < 1 ||
      payload.pageSize > 100 ||
      !("total" in payload) ||
      typeof payload.total !== "number" ||
      !Number.isSafeInteger(payload.total) ||
      payload.total < 0 ||
      payload.page !== (input.page ?? 1) ||
      payload.pageSize !== (input.pageSize ?? 20) ||
      payload.items.length !==
        Math.min(
          payload.pageSize,
          Math.max(0, payload.total - (payload.page - 1) * payload.pageSize),
        )
    ) {
      throw new ApiError(
        502,
        "Serwer zwrócił nieprawidłową historię transakcji. Spróbuj ponownie.",
      );
    }
    const items = payload.items.map((item) =>
      parseTransaction(
        item,
        "Serwer zwrócił nieprawidłową historię transakcji. Spróbuj ponownie.",
      ),
    );
    if (new Set(items.map((item) => item.id)).size !== items.length) {
      throw new ApiError(
        502,
        "Serwer zwrócił nieprawidłową historię transakcji. Spróbuj ponownie.",
      );
    }
    return {
      items,
      page: payload.page,
      pageSize: payload.pageSize,
      total: payload.total,
    };
  },

  async getCategories(signal?: AbortSignal): Promise<CategoryDto[]> {
    const payload = await apiRequest<unknown>("/categories", { signal });
    if (!Array.isArray(payload))
      throw new ApiError(
        502,
        "Serwer zwrócił nieprawidłowe kategorie. Spróbuj ponownie.",
      );
    const categories = payload.map(parseCategory);
    if (
      new Set(categories.map((category) => category.id)).size !==
      categories.length
    ) {
      throw new ApiError(
        502,
        "Serwer zwrócił nieprawidłowe kategorie. Spróbuj ponownie.",
      );
    }
    return categories;
  },

  async create(
    input: CreateTransactionInput,
    signal?: AbortSignal,
  ): Promise<TransactionDto> {
    return parseTransaction(
      await apiRequest<unknown>("/transactions", {
        method: "POST",
        signal,
        body: JSON.stringify({
          type: input.type,
          amount: input.amount,
          categoryId: input.categoryId,
          title: input.title,
          occurredOn: input.occurredOn,
          note: input.note,
        }),
      }),
    );
  },
};
