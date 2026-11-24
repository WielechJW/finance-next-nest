import { apiRequest } from "./api-client";
import {
  investmentAccountPath,
  parseInvestmentInstrument,
} from "./investments-api";
import {
  marketArray,
  marketBoolean,
  marketInteger,
  marketObject,
  marketText,
} from "./investment-market-api";

const root = (portfolioId: string, accountId: string) =>
  `${investmentAccountPath(portfolioId, accountId)}/imports`;

function summary(value: unknown) {
  const batch = marketObject(value);
  return {
    id: marketText(batch.id),
    format: marketText(batch.format),
    status: marketText(batch.status),
    createdAt: marketText(batch.createdAt),
    encoding: marketText(batch.encoding),
    rowCount: marketInteger(marketObject(batch._count).rows),
  };
}

function detail(value: unknown) {
  return {
    ...summary(value),
    rows: marketArray(marketObject(value).rows, (value) => {
      const row = marketObject(value);
      return {
        number: marketInteger(row.number),
        error: row.error === null ? null : marketText(row.error),
        data:
          row.data === null
            ? null
            : Object.fromEntries(
                Object.entries(marketObject(row.data)).map(([key, value]) => [
                  key,
                  marketText(value),
                ]),
              ),
      };
    }),
  };
}

function previewRow(value: unknown) {
  const row = marketObject(value);
  return {
    number: marketInteger(row.number),
    instrument:
      row.instrument === null
        ? null
        : parseInvestmentInstrument(row.instrument),
    needsInstrument: marketBoolean(row.needsInstrument),
    mappingError:
      row.mappingError === null ? null : marketText(row.mappingError),
    duplicate: row.duplicate === null ? null : marketText(row.duplicate),
    details: Object.fromEntries(
      Object.entries(marketObject(row.details)).map(([key, entry]) => [
        key,
        marketText(entry),
      ]),
    ),
  };
}

export type ImportPreviewRow = ReturnType<typeof previewRow>;

export type ImportBatch = ReturnType<typeof detail>;

export const importApi = {
  async list(portfolioId: string, accountId: string, signal: AbortSignal) {
    return marketArray(
      await apiRequest<unknown>(root(portfolioId, accountId), { signal }),
      summary,
    );
  },
  async create(portfolioId: string, accountId: string, file: FormData) {
    return detail(
      await apiRequest<unknown>(root(portfolioId, accountId), {
        method: "POST",
        body: file,
      }),
    );
  },
  async get(portfolioId: string, accountId: string, id: string) {
    return detail(
      await apiRequest<unknown>(
        `${root(portfolioId, accountId)}/${encodeURIComponent(id)}`,
      ),
    );
  },
  async preview(
    portfolioId: string,
    accountId: string,
    id: string,
    signal: AbortSignal,
  ) {
    return marketArray(
      await apiRequest<unknown>(
        `${root(portfolioId, accountId)}/${encodeURIComponent(id)}/preview`,
        { signal },
      ),
      previewRow,
    );
  },
  map(
    portfolioId: string,
    accountId: string,
    id: string,
    number: number,
    instrumentId: string | null,
  ) {
    return apiRequest<void>(
      `${root(portfolioId, accountId)}/${encodeURIComponent(id)}/rows/${number}/instrument`,
      {
        method: "PATCH",
        body: JSON.stringify({ instrumentId }),
      },
    );
  },
};
