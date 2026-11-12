import { ApiError, apiRequest } from "./api-client";
import { isOpeningBalanceString } from "./money";
import { isCalendarDate } from "./transaction-input";
import type {
  CategoryDto,
  CreateTransactionInput,
  TransactionDto,
  TransactionType,
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

function parseTransaction(value: unknown): TransactionDto {
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
    throw new ApiError(
      502,
      "Serwer zwrócił nieprawidłowe dane transakcji. Odśwież portfel, aby sprawdzić zapis.",
    );
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
