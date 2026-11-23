import { ApiError, apiRequest } from "./api-client";

type Metric = "revenue" | "ebit" | "netIncome";
export type ReportMetric =
  | {
      metric: Metric;
      state: "verified";
      amount: string;
      period: string;
      unit: string;
      page: number;
    }
  | { metric: Metric; state: "missing" | "needs_review" };

export type AnalysisReply = {
  answer: string;
  incomplete: boolean;
  summary: ReportMetric[] | null;
  coverage: {
    totalPages: number;
    pagesWithText: number;
    pagesInContext: number;
    contextPages?: { number: number; partial: boolean }[];
    partial: boolean;
  } | null;
};

type Turn = { question: string; reply: AnalysisReply };

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

  return analysisRequest<AnalysisReply>("chat", {
    method: "POST",
    body,
    signal,
    timeoutMs: 200_000,
  });
}
