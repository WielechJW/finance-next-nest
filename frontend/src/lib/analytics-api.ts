import { ApiError, apiRequest } from "./api-client";
import { analyticsCents } from "./analytics-money";
import { analyticsLabels, analyticsQuery } from "./analytics-period";
import { isMoneyString } from "./money";
import type {
  AnalyticsCategories,
  AnalyticsCategory,
  AnalyticsQuery,
  AnalyticsSummary,
  AnalyticsTrendPoint,
  AnalyticsTrends,
} from "./analytics-types";

function invalid(): never {
  throw new ApiError(
    502,
    "Serwer zwrócił nieprawidłowe dane analityki. Spróbuj ponownie.",
  );
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function amount(value: unknown, nonnegative = false): string {
  if (!isMoneyString(value) || (nonnegative && value.startsWith("-")))
    invalid();
  return value;
}
function totals(value: Record<string, unknown>) {
  const income = amount(value.income, true);
  const expenses = amount(value.expenses, true);
  const periodResult = amount(value.periodResult);
  if (
    analyticsCents(income) - analyticsCents(expenses) !==
    analyticsCents(periodResult)
  )
    invalid();
  return { income, expenses, periodResult };
}
function period(value: Record<string, unknown>, query: AnalyticsQuery) {
  if (
    value.from !== query.from ||
    value.to !== query.to ||
    value.currency !== "PLN"
  )
    invalid();
  return { from: query.from, to: query.to, currency: "PLN" as const };
}
function params(query: AnalyticsQuery, trends = false): string {
  const validated = analyticsQuery(query.from, query.to, query.granularity);
  return new URLSearchParams({
    from: validated.from,
    to: validated.to,
    ...(trends ? { granularity: validated.granularity } : {}),
  }).toString();
}

export const analyticsApi = {
  async summary(
    query: AnalyticsQuery,
    signal?: AbortSignal,
  ): Promise<AnalyticsSummary> {
    const data = record(
      await apiRequest<unknown>(`/analytics/summary?${params(query)}`, {
        signal,
      }),
    );
    return { ...period(data, query), ...totals(data) };
  },
  async categories(
    query: AnalyticsQuery,
    signal?: AbortSignal,
  ): Promise<AnalyticsCategories> {
    const data = record(
      await apiRequest<unknown>(`/analytics/categories?${params(query)}`, {
        signal,
      }),
    );
    const range = period(data, query);
    const totalExpenses = amount(data.totalExpenses, true);
    if (!Array.isArray(data.items)) invalid();
    const ids = new Set<string>();
    const items: AnalyticsCategory[] = data.items.map((value) => {
      const item = record(value);
      const { categoryId, categoryName, percentage } = item;
      if (
        typeof categoryId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          categoryId,
        ) ||
        ids.has(categoryId.toLowerCase()) ||
        typeof categoryName !== "string" ||
        !categoryName.trim()
      )
        invalid();
      const categoryAmount = amount(item.amount, true);
      if (
        categoryAmount === "0.00" ||
        !isMoneyString(percentage) ||
        percentage.startsWith("-") ||
        analyticsCents(percentage) > BigInt(10_000)
      )
        invalid();
      ids.add(categoryId.toLowerCase());
      return { categoryId, categoryName, amount: categoryAmount, percentage };
    });
    if (
      items.reduce(
        (sum, item) => sum + analyticsCents(item.amount),
        BigInt(0),
      ) !== analyticsCents(totalExpenses)
    )
      invalid();
    for (let i = 1; i < items.length; i++) {
      const previous = items[i - 1],
        current = items[i];
      if (
        analyticsCents(previous.amount) < analyticsCents(current.amount) ||
        (previous.amount === current.amount &&
          previous.categoryId.toLowerCase() > current.categoryId.toLowerCase())
      )
        invalid();
    }
    return { ...range, totalExpenses, items };
  },
  async trends(
    query: AnalyticsQuery,
    signal?: AbortSignal,
  ): Promise<AnalyticsTrends> {
    const data = record(
      await apiRequest<unknown>(`/analytics/trends?${params(query, true)}`, {
        signal,
      }),
    );
    const range = period(data, query);
    if (data.granularity !== query.granularity || !Array.isArray(data.items))
      invalid();
    const labels = analyticsLabels(query);
    if (data.items.length !== labels.length) invalid();
    const items: AnalyticsTrendPoint[] = data.items.map((value, index) => {
      const point = record(value);
      if (point.period !== labels[index]) invalid();
      return { period: labels[index], ...totals(point) };
    });
    return { ...range, granularity: query.granularity, items };
  },
};
