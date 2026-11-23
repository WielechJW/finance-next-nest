import { apiRequest } from "./api-client";
import { investmentAccountPath } from "./investments-api";
import {
  marketArray,
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
};
