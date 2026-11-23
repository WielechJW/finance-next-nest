import { ApiError, apiRequest } from "./api-client";

type Metric =
  "revenue" | "ebit" | "netIncome" | "operatingCashFlow" | "longTermDebt";
export type ReportMetric =
  | {
      metric: Metric;
      state: "verified";
      amount: string;
      period: string;
      unit: string;
      page: number;
      scope?: "consolidated" | "standalone";
    }
  | { metric: Metric; state: "missing" | "needs_review" };

export type AnalysisReply = {
  answer: string;
  incomplete: boolean;
  summary: ReportMetric[] | null;
  operatingMargin?: { percent: string; period: string; pages: number[] } | null;
  market?: {
    instrument: { id: string; ticker: string; mic: string; currency: string };
    status: "fresh" | "stale" | "missing" | "unexpected";
    expectedSessionOn: string;
    quote: { close: string; sessionOn: string | null; source: string } | null;
  } | null;
  coverage: {
    totalPages: number;
    pagesWithText: number;
    pagesInContext: number;
    contextPages?: { number: number; partial: boolean }[];
    partial: boolean;
  } | null;
};

type Turn = { question: string; reply: AnalysisReply };

export type IssuerReport = {
  id: string;
  filename: string;
  scope: "CONSOLIDATED" | "STANDALONE";
  periodKind: "ANNUAL" | "QUARTERLY";
  currency: "PLN" | "USD" | "EUR";
  periodStart: string;
  periodEnd: string;
  publishedOn: string;
  sourceUrl: string;
  version: number;
  company: { id: string; name: string };
  instrument: { id: string; ticker: string; mic: string };
  facts: {
    metric: string;
    amount: string;
    unit: string;
    period: string;
    page: number;
  }[];
};

const modelErrors: Record<string, string> = {
  MODEL_CONFIG: "Sprawdź ustawienia adresu LM Studio w backendzie.",
  MODEL_OFFLINE:
    "LM Studio jest niedostępne. Sprawdź, czy lokalny serwer API działa.",
  MODEL_AUTH:
    "LM Studio odrzuciło token API. Sprawdź jego konfigurację w backendzie.",
  MODEL_EMPTY:
    "Model zakończył generację bez odpowiedzi. Spróbuj ponownie z konkretnym pytaniem.",
  MODEL_RESPONSE:
    "LM Studio zwróciło nieprawidłową odpowiedź. Sprawdź połączenie i spróbuj ponownie.",
  MODEL_TIMEOUT: "LM Studio nie odpowiedziało w wyznaczonym czasie.",
};

async function analysisRequest<T>(
  path: "status" | "chat",
  options: Parameters<typeof apiRequest>[1],
): Promise<T> {
  try {
    return await apiRequest<T>("/fundamental-analysis/" + path, options);
  } catch (error) {
    if (error instanceof ApiError) {
      const message =
        error.status === 413
          ? "Plik PDF może mieć maksymalnie 15 MB."
          : error.code && modelErrors[error.code];
      if (message) throw new ApiError(error.status, message, error.code);
    }
    throw error;
  }
}

export function requestAnalysisStatus(signal: AbortSignal) {
  return analysisRequest<{ model: string }>("status", {
    signal,
    timeoutMs: 8000,
  });
}

export async function requestAnalysis(
  question: string,
  turns: Turn[],
  report: File | null,
  signal: AbortSignal,
  instrumentId?: string,
  reportId?: string,
): Promise<AnalysisReply> {
  const body = new FormData();
  body.set("question", question);
  body.set(
    "history",
    JSON.stringify(
      turns.slice(-3).flatMap(({ question, reply }) => [
        { role: "user", content: question },
        { role: "assistant", content: reply.answer.slice(0, 6000) },
      ]),
    ),
  );
  if (report) body.set("report", report);
  if (report && instrumentId) body.set("instrumentId", instrumentId);
  if (reportId) body.set("reportId", reportId);

  return analysisRequest<AnalysisReply>("chat", {
    method: "POST",
    body,
    signal,
    timeoutMs: 200_000,
  });
}

const reportsPath = "/fundamental-analysis/reports";

export function listIssuerReports(page: number, signal: AbortSignal) {
  return apiRequest<{ items: IssuerReport[]; hasNext: boolean }>(
    reportsPath + "?page=" + page,
    { signal },
  );
}

export function importIssuerReport(body: FormData, signal: AbortSignal) {
  return apiRequest<IssuerReport>(reportsPath, {
    method: "POST",
    body,
    signal,
    timeoutMs: 70_000,
  });
}

export function openIssuerReport(id: string, signal: AbortSignal) {
  return apiRequest<Blob>(reportsPath + "/" + encodeURIComponent(id) + "/pdf", {
    responseType: "blob",
    signal,
  });
}

export function deleteIssuerReport(id: string, signal: AbortSignal) {
  return apiRequest<void>(reportsPath + "/" + encodeURIComponent(id), {
    method: "DELETE",
    signal,
  });
}
