import { apiRequest } from "./api-client";
import { investmentAccountPath } from "./investments-api";
import {
  marketArray,
  marketBoolean,
  marketInteger,
  marketNullableDecimal,
  marketObject,
  marketText,
} from "./investment-market-api";

type Scope = { portfolioId: string; accountId: string; strategyId: string };
const root = (scope: Scope) =>
  `${investmentAccountPath(scope.portfolioId, scope.accountId)}/strategies/${encodeURIComponent(scope.strategyId)}/backtests`;
function summary(value: unknown) {
  const row = marketObject(value);
  return {
    id: marketText(row.id),
    baselineId: row.baselineId === null ? null : marketText(row.baselineId),
    phase: marketText(row.phase),
    status: marketText(row.status),
    fromOn: marketText(row.fromOn).slice(0, 10),
    toOn: marketText(row.toOn).slice(0, 10),
    error: row.error === null ? null : marketText(row.error),
    modelVersion: marketText(row.modelVersion),
    inputHash: marketText(row.inputHash),
    version: marketInteger(marketObject(row.version).number),
  };
}
function performance(value: unknown) {
  const row = marketObject(value);
  return {
    initialCapital: marketNullableDecimal(row.initialCapital),
    finalCapital: marketNullableDecimal(row.finalCapital),
    profit: marketNullableDecimal(row.profit),
    maxDrawdownPercent: marketNullableDecimal(row.maxDrawdownPercent),
    averageExposurePercent: marketNullableDecimal(row.averageExposurePercent),
    turnover: marketNullableDecimal(row.turnover),
    executedTrades: marketInteger(row.executedTrades),
    complete: marketBoolean(row.complete),
    curve: marketArray(row.curve, (item) => {
      const point = marketObject(item);
      return {
        sessionOn: marketText(point.sessionOn),
        capital: marketNullableDecimal(point.capital),
      };
    }),
  };
}
function detail(value: unknown) {
  const row = marketObject(value);
  const report = row.report === null ? null : marketObject(row.report);
  const coverage = report?.inputCoverage
    ? marketObject(report.inputCoverage)
    : null;
  return {
    ...summary(value),
    verified: row.verified === true,
    report: report && {
      coverage: coverage && {
        source: marketText(coverage.source),
        instruments: marketInteger(coverage.instruments),
        delisted: marketInteger(coverage.delisted),
      },
      strategy: performance(report.strategy),
      benchmark: performance(report.benchmark),
      currency: marketText(report.currency),
      priceBasis: marketText(report.priceBasis),
      costs: { ...marketObject(report.costs) },
      assumptions: { ...marketObject(report.assumptions) },
    },
  };
}
export type BacktestDetail = ReturnType<typeof detail>;

export const backtestsApi = {
  async list(scope: Scope, signal: AbortSignal) {
    return marketArray(
      await apiRequest<unknown>(root(scope), { signal }),
      summary,
    );
  },
  async submit(scope: Scope, form: FormData) {
    return detail(
      await apiRequest<unknown>(root(scope), {
        method: "POST",
        body: form,
        timeoutMs: 30000,
      }),
    );
  },
  async get(scope: Scope, id: string) {
    return detail(
      await apiRequest<unknown>(`${root(scope)}/${encodeURIComponent(id)}`),
    );
  },
  async replay(scope: Scope, id: string) {
    return detail(
      await apiRequest<unknown>(
        `${root(scope)}/${encodeURIComponent(id)}/replay`,
      ),
    );
  },
};
