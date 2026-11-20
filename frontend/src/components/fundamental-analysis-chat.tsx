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
  type AnalysisReply,
} from "@/lib/fundamental-analysis-api";
import { UiIcon } from "./ui-icon";
import { useSession } from "./session-provider";
import styles from "./fundamental-analysis-chat.module.css";

const DEFAULT_QUESTION =
  "Podsumuj najważniejsze informacje z raportu i oceń atrakcyjność inwestycji.";

function ModelReply({ reply }: { reply: AnalysisReply }) {
  const { coverage } = reply;
  return (
    <div className={styles.reply}>
      <div className={styles.author}>
        <UiIcon name="cpu" /> Lokalny model
      </div>
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
  const [report, setReport] = useState<File | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState("");
  const [error, setError] = useState("");
  const upload = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const reportLocked = turns.some(({ reply }) => reply.coverage !== null);

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
    setReport(file);
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
    setReport(null);
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
              <ModelReply reply={reply} />
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
                        setReport(null);
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
