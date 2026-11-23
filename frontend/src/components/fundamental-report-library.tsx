"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  deleteIssuerReport,
  importIssuerReport,
  listIssuerReports,
  openIssuerReport,
  type IssuerReport,
} from "@/lib/fundamental-analysis-api";
import type { InvestmentInstrument } from "@/lib/investments-api";
import { InstrumentPicker } from "./investments/instrument-picker";
import styles from "./fundamental-analysis-chat.module.css";

type Result = {
  page: number;
  revision: number;
  items: IssuerReport[];
  hasNext: boolean;
  error?: string;
};

function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Nie udało się wykonać operacji.";
}

export function FundamentalReportLibrary({
  disabled,
  onOpen,
  onRemove,
}: {
  disabled: boolean;
  onOpen(report: IssuerReport, pdf: Blob): void;
  onRemove(id: string): void;
}) {
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [instrument, setInstrument] = useState<InvestmentInstrument | null>(
    null,
  );
  const [currency, setCurrency] = useState("PLN");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const action = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void listIssuerReports(page, controller.signal).then(
      (response) => {
        if (!controller.signal.aborted)
          setResult({ page, revision, ...response });
      },
      (failure: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            page,
            revision,
            items: [],
            hasNext: false,
            error: message(failure),
          });
      },
    );
    return () => controller.abort();
  }, [page, revision]);

  useEffect(() => () => action.current?.abort(), []);

  async function run(operation: (signal: AbortSignal) => Promise<void>) {
    if (disabled || action.current) return;
    const controller = new AbortController();
    action.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation(controller.signal);
    } catch (failure) {
      if (!controller.signal.aborted) setError(message(failure));
    } finally {
      if (action.current === controller) {
        action.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = new FormData(form);
    const file = body.get("report");
    if (!instrument || !(file instanceof File) || !file.size) return;
    if (file.size > 15 * 1024 * 1024) {
      setError("Plik PDF może mieć maksymalnie 15 MB.");
      return;
    }
    body.set("filename", Array.from(file.name).slice(0, 200).join(""));
    body.set("instrumentId", instrument.id);
    void run(async (signal) => {
      const report = await importIssuerReport(body, signal);
      if (signal.aborted) return;
      form.reset();
      setInstrument(null);
      setPage(1);
      setRevision((value) => value + 1);
      setNotice("Zapisano raport, wersja " + report.version + ".");
    });
  }

  const current =
    result?.page === page && result.revision === revision ? result : null;

  return (
    <details className={styles.library}>
      <summary>Zapisane raporty</summary>
      <details className={styles.libraryImport}>
        <summary>Dodaj raport emitenta</summary>
        <form onSubmit={save}>
          <fieldset className={styles.instrument} disabled={disabled || busy}>
            <legend>Instrument raportu</legend>
            <InstrumentPicker
              selected={instrument}
              onChange={(next) => {
                setInstrument(next);
                if (next) setCurrency(next.currency);
              }}
            />
          </fieldset>
          <fieldset
            className={styles.libraryFields}
            disabled={disabled || busy}
          >
            <label>
              Rodzaj okresu
              <select name="periodKind">
                <option value="ANNUAL">Roczny</option>
                <option value="QUARTERLY">Kwartalny</option>
              </select>
            </label>
            <label>
              Zakres
              <select name="scope">
                <option value="CONSOLIDATED">Skonsolidowany</option>
                <option value="STANDALONE">Jednostkowy</option>
              </select>
            </label>
            <label>
              Początek okresu <input type="date" name="periodStart" required />
            </label>
            <label>
              Koniec okresu <input type="date" name="periodEnd" required />
            </label>
            <label>
              Data publikacji <input type="date" name="publishedOn" required />
            </label>
            <label>
              Waluta raportu
              <select
                name="currency"
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
              >
                <option>PLN</option>
                <option>USD</option>
                <option>EUR</option>
              </select>
            </label>
            <label className={styles.libraryWide}>
              Adres dokumentu u emitenta
              <input
                type="url"
                name="sourceUrl"
                maxLength={2048}
                placeholder="https://"
                required
              />
            </label>
            <label className={styles.libraryWide}>
              Opis działalności z raportu (opcjonalnie)
              <textarea name="businessSummary" maxLength={600} rows={3} />
            </label>
            <label className={styles.libraryWide}>
              Plik PDF
              <input
                type="file"
                name="report"
                accept=".pdf,application/pdf"
                required
              />
            </label>
            <button type="submit" disabled={!instrument}>
              {busy ? "Przetwarzanie…" : "Zapisz raport"}
            </button>
          </fieldset>
        </form>
      </details>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!current && <p role="status">Wczytywanie raportów…</p>}
      {current?.error && (
        <p role="alert">
          {current.error}{" "}
          <button
            type="button"
            onClick={() => setRevision((value) => value + 1)}
          >
            Ponów
          </button>
        </p>
      )}
      {current && !current.error && current.items.length === 0 && (
        <p>Brak zapisanych raportów.</p>
      )}
      {!!current?.items.length && (
        <ul className={styles.libraryList}>
          {current.items.map((report) => (
            <li key={report.id}>
              <strong>
                {report.instrument.ticker} · {report.company.name}
              </strong>
              <span>{report.filename}</span>
              <span>
                {report.periodStart} – {report.periodEnd} · opublikowano{" "}
                {report.publishedOn} · wersja {report.version}
                {report.scope === "CONSOLIDATED"
                  ? " · skonsolidowany"
                  : " · jednostkowy"}
              </span>
              <div className={styles.libraryActions}>
                <button
                  type="button"
                  disabled={disabled || busy}
                  onClick={() => {
                    void run(async (signal) => {
                      const pdf = await openIssuerReport(report.id, signal);
                      if (!signal.aborted) {
                        onOpen(report, pdf);
                        setNotice("Załączono raport do nowej rozmowy.");
                      }
                    });
                  }}
                >
                  Otwórz w czacie
                </button>
                <a href={report.sourceUrl} target="_blank" rel="noreferrer">
                  Źródło
                </a>
                <button
                  type="button"
                  disabled={disabled || busy}
                  onClick={() => {
                    if (
                      !window.confirm(
                        "Usunąć tę wersję raportu i jej odczytaną treść?",
                      )
                    )
                      return;
                    void run(async (signal) => {
                      await deleteIssuerReport(report.id, signal);
                      if (signal.aborted) return;
                      onRemove(report.id);
                      setRevision((value) => value + 1);
                      setNotice("Usunięto raport.");
                    });
                  }}
                >
                  Usuń wersję
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {(page > 1 || current?.hasNext) && (
        <div className={styles.libraryActions}>
          <button
            type="button"
            disabled={page === 1 || busy}
            onClick={() => setPage((value) => value - 1)}
          >
            Poprzednia
          </button>
          <span>Strona {page}</span>
          <button
            type="button"
            disabled={!current?.hasNext || busy}
            onClick={() => setPage((value) => value + 1)}
          >
            Następna
          </button>
        </div>
      )}
    </details>
  );
}
