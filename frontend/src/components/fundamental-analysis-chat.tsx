"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { ApiError } from "@/lib/api-client";
import {
  requestAnalysis,
  requestAnalysisStatus,
  type AnalysisReply,
  type ReportMetric,
} from "@/lib/fundamental-analysis-api";
import { UiIcon } from "./ui-icon";
import { useSession } from "./session-provider";
import styles from "./fundamental-analysis-chat.module.css";

const DEFAULT_QUESTION =
  "Podsumuj najważniejsze informacje z raportu i oceń atrakcyjność inwestycji.";

const metricLabels = {
  revenue: "Przychody",
  ebit: "EBIT",
  netIncome: "Zysk netto",
};

function formatAmount(amount: string) {
  const [integer, decimals] = amount.split(".");
  return (
    integer!.replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f") +
    (decimals ? "," + decimals : "")
  );
}

function ConnectionStatus() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<
    | { kind: "checking" }
    | { kind: "ready"; model: string }
    | { kind: "failed"; message: string }
  >({ kind: "checking" });
  useEffect(() => {
    const request = new AbortController();
    void requestAnalysisStatus(request.signal).then(
      ({ model }) => {
        if (!request.signal.aborted) setState({ kind: "ready", model });
      },
      (error: unknown) => {
        if (!request.signal.aborted)
          setState({
            kind: "failed",
            message:
              error instanceof ApiError
                ? error.message
                : "Nie udało się sprawdzić połączenia.",
          });
      },
    );
    return () => request.abort();
  }, [attempt]);

  return (
    <div className={styles.connection}>
      <div role="status">
        <strong>Połączenie z modelem</strong>
        {state.kind === "checking" && <p>Sprawdzanie połączenia…</p>}
        {state.kind === "ready" && (
          <p className={styles.connected}>
            <UiIcon name="check-circle" /> {state.model}
          </p>
        )}
        {state.kind === "failed" && (
          <p className={styles.error}>{state.message}</p>
        )}
      </div>
      <button
        type="button"
        className={styles.secondary}
        disabled={state.kind === "checking"}
        onClick={() => {
          setState({ kind: "checking" });
          setAttempt((n) => n + 1);
        }}
      >
        <UiIcon name="arrow-clockwise" /> Sprawdź połączenie
      </button>
    </div>
  );
}

function ReportSummary({
  facts,
  pdfUrl,
}: {
  facts: ReportMetric[];
  pdfUrl: string;
}) {
  return (
    <section className={styles.reportSummary} aria-label="Karta raportu">
      <h2>Karta raportu</h2>
      <dl className={styles.metrics}>
        {facts.map((fact) => (
          <div className={styles.metric} key={fact.metric}>
            <dt>{metricLabels[fact.metric]}</dt>
            {fact.state === "verified" ? (
              <dd>
                <strong>
                  {formatAmount(fact.amount)} {fact.unit}
                </strong>
                <span>{fact.period}</span>
                <a
                  href={pdfUrl + "#page=" + fact.page}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={
                    metricLabels[fact.metric] +
                    ", otwórz stronę " +
                    fact.page +
                    " PDF"
                  }
                >
                  <UiIcon name="file-pdf" /> Strona {fact.page}
                </a>
              </dd>
            ) : (
              <dd>
                {fact.state === "needs_review"
                  ? "Wymaga weryfikacji"
                  : "Brak danych w rachunku wyników"}
              </dd>
            )}
          </div>
        ))}
      </dl>
    </section>
  );
}

function ModelReply({
  reply,
  pdfUrl,
}: {
  reply: AnalysisReply;
  pdfUrl?: string;
}) {
  const { coverage } = reply;
  return (
    <div className={styles.reply}>
      <div className={styles.author}>
        <UiIcon name="cpu" /> Lokalny model
      </div>
      {reply.summary && pdfUrl && (
        <ReportSummary facts={reply.summary} pdfUrl={pdfUrl} />
      )}
      <p className={styles.answer}>{reply.answer}</p>
      {coverage?.partial && (
        <p className={styles.note}>
          Do modelu trafiły fragmenty z {coverage.pagesInContext} z{" "}
          {coverage.totalPages} stron PDF.
          {coverage.pagesWithText < coverage.totalPages &&
            " Część stron nie zawierała tekstu do odczytania."}
        </p>
      )}
      {reply.incomplete && (
        <p className={styles.note}>
          Odpowiedź osiągnęła limit długości. Możesz poprosić o rozwinięcie
          wybranego punktu.
        </p>
      )}
    </div>
  );
}

export function FundamentalAnalysisChat() {
  const { state } = useSession();
  if (state.status !== "authenticated") return null;
  return <Chat key={state.user.id} />;
}

function Chat() {
  const [turns, setTurns] = useState<
    { question: string; reply: AnalysisReply }[]
  >([]);
  const [question, setQuestion] = useState("");
  const [attachment, setAttachment] = useState<{
    file: File;
    url: string;
  } | null>(null);
  const report = attachment?.file ?? null;
  const [pendingQuestion, setPendingQuestion] = useState("");
  const [error, setError] = useState("");
  const upload = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const reportTurn = turns.findIndex(({ reply }) => reply.coverage !== null);
  const reportLocked = reportTurn !== -1;

  useEffect(
    () => () => {
      if (attachment) URL.revokeObjectURL(attachment.url);
    },
    [attachment],
  );

  useEffect(
    () => () => {
      const request = activeRequest.current;
      activeRequest.current = null;
      request?.abort();
    },
    [],
  );
  useEffect(() => {
    if (pendingQuestion && transcript.current) {
      transcript.current.scrollTop = transcript.current.scrollHeight;
    }
  }, [pendingQuestion]);

  function attachReport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
      setError("Wybierz plik PDF.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError("Plik PDF może mieć maksymalnie 15 MB.");
      return;
    }
    setError("");
    setAttachment({ file, url: URL.createObjectURL(file) });
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt =
      question.trim() || (report && !reportLocked ? DEFAULT_QUESTION : "");
    if (activeRequest.current || !prompt) return;

    const controller = new AbortController();
    activeRequest.current = controller;
    setPendingQuestion(prompt);
    setError("");
    try {
      const reply = await requestAnalysis(
        prompt,
        turns,
        report,
        controller.signal,
      );
      setTurns((previous) => [...previous, { question: prompt, reply }]);
      setQuestion("");
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(
          failure instanceof ApiError
            ? failure.message
            : "Nie udało się wykonać analizy. Spróbuj ponownie.",
        );
      }
    } finally {
      if (activeRequest.current === controller) {
        setPendingQuestion("");
        activeRequest.current = null;
      }
    }
  }

  function reset() {
    setTurns([]);
    setAttachment(null);
    setQuestion("");
    setError("");
    input.current?.focus();
  }

  return (
    <section
      className={styles.workspace}
      aria-labelledby="fundamental-analysis-heading"
    >
      <header className={styles.header}>
        <div>
          <h1 id="fundamental-analysis-heading">Analiza fundamentalna</h1>
          <p>Omawiaj wyniki, ryzyka i wycenę spółek z modelem w LM Studio.</p>
        </div>
        <button
          type="button"
          className={styles.secondary}
          onClick={reset}
          disabled={
            !!pendingQuestion ||
            (!report && !turns.length && !question && !error)
          }
        >
          <UiIcon name="plus" /> Nowa rozmowa
        </button>
      </header>

      <ConnectionStatus />
      <div className={styles.chat}>
        <div
          className={styles.transcript}
          ref={transcript}
          role="log"
          aria-label="Rozmowa z modelem"
          tabIndex={0}
        >
          {!turns.length && !pendingQuestion && (
            <div className={styles.empty}>
              <span className={styles.emptyIcon}>
                <UiIcon name="file-magnifying-glass" />
              </span>
              <h2>Przeanalizuj raport spółki</h2>
              <p>
                Dołącz sprawozdanie lub wpisz pytanie. Model podsumuje kluczowe
                dane i wskaże, czego potrzeba do oceny inwestycji.
              </p>
            </div>
          )}
          {turns.map(({ question, reply }, index) => (
            <div className={styles.turn} key={index}>
              <p className={styles.question}>{question}</p>
              <ModelReply
                reply={reply}
                pdfUrl={index === reportTurn ? attachment?.url : undefined}
              />
            </div>
          ))}
          {pendingQuestion && (
            <div className={styles.turn}>
              <p className={styles.question}>{pendingQuestion}</p>
              <p className={styles.pending} role="status">
                <UiIcon name="cpu" /> Model analizuje dane…
              </p>
            </div>
          )}
        </div>

        <form className={styles.composer} onSubmit={send}>
          <label
            className={styles.label}
            htmlFor="fundamental-analysis-question"
          >
            Twoja wiadomość
          </label>
          <textarea
            id="fundamental-analysis-question"
            ref={input}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            disabled={!!pendingQuestion}
            rows={2}
            maxLength={1500}
            placeholder="Np. jak zmieniła się marża i co wpłynęło na wynik?"
          />
          <input
            ref={upload}
            type="file"
            accept=".pdf,application/pdf"
            onChange={attachReport}
            hidden
          />
          <div className={styles.controls}>
            <div className={styles.attachment}>
              {report ? (
                <div className={styles.file}>
                  <UiIcon name="file-pdf" />
                  <span title={report.name}>{report.name}</span>
                  {!reportLocked && (
                    <button
                      type="button"
                      className={styles.remove}
                      aria-label="Usuń załącznik"
                      disabled={!!pendingQuestion}
                      onClick={() => {
                        setAttachment(null);
                        setError("");
                      }}
                    >
                      <UiIcon name="x" />
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    className={styles.secondary}
                    disabled={!!pendingQuestion}
                    onClick={() => upload.current?.click()}
                  >
                    <UiIcon name="paperclip" /> Dodaj PDF
                  </button>
                  <span className={styles.fileLimit}>
                    Do 15 MB, z warstwą tekstową
                  </span>
                </>
              )}
            </div>
            {pendingQuestion ? (
              <button
                type="button"
                className={styles.secondary}
                onClick={() => activeRequest.current?.abort()}
              >
                Anuluj
              </button>
            ) : (
              <button
                type="submit"
                disabled={!question.trim() && (!report || reportLocked)}
              >
                <UiIcon name="paper-plane-tilt" />{" "}
                {report && !reportLocked && !question.trim()
                  ? "Analizuj raport"
                  : "Wyślij"}
              </button>
            )}
          </div>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </form>
      </div>
      <p className={styles.footer}>
        Sprawdź kluczowe dane w źródle przed podjęciem decyzji inwestycyjnej.
      </p>
    </section>
  );
}
