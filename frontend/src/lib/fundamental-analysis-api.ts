import { ApiError, apiRequest } from "./api-client";

export type AnalysisReply = {
  answer: string;
  incomplete: boolean;
  coverage: {
    totalPages: number;
    pagesWithText: number;
    pagesInContext: number;
    partial: boolean;
  } | null;
};

type Turn = { question: string; reply: AnalysisReply };

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

  try {
    return await apiRequest<AnalysisReply>("/fundamental-analysis/chat", {
      method: "POST",
      body,
      signal,
      timeoutMs: 200_000,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      switch (error.status) {
        case 413:
          throw new ApiError(413, "Plik PDF może mieć maksymalnie 15 MB.");
        case 502:
          throw new ApiError(
            502,
            "LM Studio nie zwróciło gotowej odpowiedzi. Upewnij się, że model jest załadowany. Jeśli używasz Qwen w trybie Enable Thinking, spróbuj go wyłączyć.",
          );
        case 503:
          throw new ApiError(
            503,
            "Nie udało się połączyć z LM Studio. Sprawdź adres i port w Local Model API (Bionic) lub Developer (LM Studio) oraz konfigurację backendu.",
          );
        case 504:
          throw new ApiError(
            504,
            "Analiza trwała zbyt długo. Spróbuj krótszego raportu lub wyłącz Enable Thinking w ustawieniach modelu.",
          );
      }
    }
    throw error;
  }
}
