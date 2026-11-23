import { apiRequest } from "./api-client";
import type { IssuerReport } from "./fundamental-analysis-api";
import {
  marketArray,
  marketDecimal,
  marketInteger,
  marketNullableDecimal,
  marketObject,
  marketText,
} from "./investment-market-api";

export type ResearchFilters = {
  scope: IssuerReport["scope"];
  missing: "include" | "exclude" | "only";
  minOperatingMargin: string;
  minNetMargin: string;
};

export type NoteInput = {
  thesis: string;
  risks: string;
  reviewConditions: string;
};

const root = "/fundamental-analysis/research";
const notePath = (instrumentId: string) =>
  `${root}/notes/${encodeURIComponent(instrumentId)}`;

function parseNote(value: unknown) {
  const note = marketObject(value);
  return {
    thesis: marketText(note.thesis),
    risks: marketText(note.risks),
    reviewConditions: marketText(note.reviewConditions),
    updatedAt: marketText(note.updatedAt),
  };
}

function parseRow(value: unknown) {
  const row = marketObject(value);
  const instrument = marketObject(row.instrument);
  const report = row.report === null ? null : marketObject(row.report);
  return {
    id: marketText(instrument.id),
    ticker: marketText(instrument.ticker),
    mic: marketText(instrument.mic),
    name: instrument.name === null ? null : marketText(instrument.name),
    operatingMargin: marketNullableDecimal(row.operatingMargin),
    netMargin: marketNullableDecimal(row.netMargin),
    report: report && {
      id: marketText(report.id),
      periodStart: marketText(report.periodStart),
      periodEnd: marketText(report.periodEnd),
      currency: marketText(report.currency),
      facts: marketArray(report.facts, (value) => {
        const fact = marketObject(value);
        return {
          metric: marketText(fact.metric),
          amount: marketDecimal(fact.amount),
          unit: marketText(fact.unit),
          page: marketInteger(fact.page),
        };
      }),
    },
  };
}

export type ResearchRow = ReturnType<typeof parseRow>;
export type InvestmentNote = ReturnType<typeof parseNote>;

export const researchApi = {
  async note(instrumentId: string, signal: AbortSignal) {
    const { note } = marketObject(
      await apiRequest<unknown>(notePath(instrumentId), { signal }),
    );
    return note === null ? null : parseNote(note);
  },
  async saveNote(instrumentId: string, note: NoteInput) {
    return parseNote(
      await apiRequest<unknown>(notePath(instrumentId), {
        method: "PATCH",
        body: JSON.stringify(note),
      }),
    );
  },
  deleteNote(instrumentId: string) {
    return apiRequest<void>(notePath(instrumentId), { method: "DELETE" });
  },
  async screen(filters: ResearchFilters, signal: AbortSignal) {
    const query = new URLSearchParams({
      scope: filters.scope,
      missing: filters.missing,
    });
    if (filters.minOperatingMargin)
      query.set("minOperatingMargin", filters.minOperatingMargin);
    if (filters.minNetMargin) query.set("minNetMargin", filters.minNetMargin);
    return marketArray(
      await apiRequest<unknown>(`${root}/screen?${query}`, { signal }),
      parseRow,
    );
  },
};
