import { apiRequest } from "./api-client";
import {
  investmentAccountPath,
  parseInvestmentInstrument,
} from "./investments-api";
import {
  marketArray,
  marketBoolean,
  marketDecimal,
  marketInteger,
  marketObject,
  marketText,
} from "./investment-market-api";

const root = (portfolioId: string, accountId: string) =>
  `${investmentAccountPath(portfolioId, accountId)}/strategies`;
const sub = (portfolioId: string, accountId: string, id: string) =>
  `${root(portfolioId, accountId)}/${encodeURIComponent(id)}`;

function parameters(value: unknown) {
  const row = marketObject(value);
  return {
    fastSessions: marketInteger(row.fastSessions),
    slowSessions: marketInteger(row.slowSessions),
    validForMinutes: marketInteger(row.validForMinutes),
  };
}
function version(value: unknown) {
  const row = marketObject(value);
  return {
    number: marketInteger(row.number),
    codeVersion: marketText(row.codeVersion),
    ruleKey: marketText(row.ruleKey),
  };
}
function strategy(value: unknown) {
  const row = marketObject(value);
  return {
    id: marketText(row.id),
    name: marketText(row.name),
    enabled: marketBoolean(row.enabled),
    notifyOnSignal: marketBoolean(row.notifyOnSignal),
    instrument: parseInvestmentInstrument(row.instrument),
    version: marketArray(row.versions, (value) => ({
      ...version(value),
      parameters: parameters(marketObject(value).parameters),
    }))[0],
  };
}
function decision(value: unknown) {
  const row = marketObject(value);
  const evidence = marketObject(row.evidence);
  const averages =
    row.averages === undefined ? null : marketObject(row.averages);
  return {
    kind: marketText(row.kind),
    reason: marketText(row.reason),
    side: row.side === undefined ? null : marketText(row.side),
    validUntil:
      row.validUntil === undefined ? null : marketText(row.validUntil),
    expectedSessionOn:
      evidence.expectedSessionOn === null
        ? null
        : marketText(evidence.expectedSessionOn),
    barIds: marketArray(evidence.barIds, marketText),
    splitIds: marketArray(evidence.splitIds, marketText),
    averages: averages && {
      previousFast: marketDecimal(averages.previousFast),
      previousSlow: marketDecimal(averages.previousSlow),
      fast: marketDecimal(averages.fast),
      slow: marketDecimal(averages.slow),
    },
  };
}
function run(value: unknown) {
  const row = marketObject(value);
  return {
    id: marketText(row.id),
    decidedAt: marketText(row.decidedAt),
    version: version(row.version),
    decision: decision(row.decision),
  };
}
function replay(value: unknown) {
  const response = marketObject(value);
  const saved = marketObject(response.run);
  const input = saved.input === null ? null : marketObject(saved.input);
  const portfolio = input && marketObject(input.portfolio);
  return {
    run: run(saved),
    parameters: parameters(marketObject(saved.version).parameters),
    computed: response.computed === null ? null : decision(response.computed),
    input: input &&
      portfolio && {
        portfolio: {
          cash: marketDecimal(portfolio.cash),
          quantity: marketDecimal(portfolio.quantity),
        },
        eventIds: marketArray(input.eventIds, marketText),
        bars: marketArray(input.bars, (value) => {
          const bar = marketObject(value);
          return {
            id: marketText(bar.id),
            close: marketDecimal(bar.close),
            revision: marketInteger(bar.revision),
            availableAt: marketText(bar.availableAt),
            sessionOn: marketText(bar.sessionOn),
          };
        }),
      },
  };
}

export type Strategy = ReturnType<typeof strategy>;
export type StrategyParameters = ReturnType<typeof parameters>;
export type StrategyRun = ReturnType<typeof run>;
export type StrategyReplay = ReturnType<typeof replay>;

export const strategyApi = {
  async list(portfolioId: string, accountId: string, signal: AbortSignal) {
    return marketArray(
      await apiRequest<unknown>(root(portfolioId, accountId), { signal }),
      strategy,
    );
  },
  async create(
    portfolioId: string,
    accountId: string,
    name: string,
    instrumentId: string,
    parameters: StrategyParameters,
  ) {
    return strategy(
      await apiRequest<unknown>(root(portfolioId, accountId), {
        method: "POST",
        body: JSON.stringify({ name, instrumentId, parameters }),
      }),
    );
  },
  async revise(
    portfolioId: string,
    accountId: string,
    id: string,
    parameters: StrategyParameters,
  ) {
    return apiRequest(`${sub(portfolioId, accountId, id)}/versions`, {
      method: "POST",
      body: JSON.stringify({ parameters }),
    });
  },
  async schedule(
    portfolioId: string,
    accountId: string,
    id: string,
    enabled: boolean,
    notifyOnSignal: boolean,
  ) {
    return strategy(
      await apiRequest<unknown>(`${sub(portfolioId, accountId, id)}/schedule`, {
        method: "PATCH",
        body: JSON.stringify({ enabled, notifyOnSignal }),
      }),
    );
  },
  async evaluate(portfolioId: string, accountId: string, id: string) {
    return run(
      await apiRequest<unknown>(`${sub(portfolioId, accountId, id)}/runs`, {
        method: "POST",
        body: "{}",
        timeoutMs: 25000,
      }),
    );
  },
  async runs(
    portfolioId: string,
    accountId: string,
    id: string,
    page: number,
    pageSize: number,
    signal: AbortSignal,
  ) {
    return marketArray(
      await apiRequest<unknown>(
        `${sub(portfolioId, accountId, id)}/runs?${new URLSearchParams({ page: String(page), pageSize: String(pageSize) })}`,
        { signal },
      ),
      run,
    );
  },
  async replay(
    portfolioId: string,
    accountId: string,
    id: string,
    runId: string,
  ) {
    return replay(
      await apiRequest<unknown>(
        `${sub(portfolioId, accountId, id)}/runs/${encodeURIComponent(runId)}/replay`,
      ),
    );
  },
};
