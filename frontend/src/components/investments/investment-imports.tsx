"use client";

import Link from "next/link";
import { useCallback, useState, type FormEvent } from "react";
import { InvestmentExports } from "./investment-exports";
import { ImportPreview } from "./investment-import-preview";
import { importApi, type ImportBatch } from "@/lib/investment-import-api";
import { useInvestmentResource } from "./use-investment-resource";
import styles from "./investments.module.css";

const formats = {
  GENERIC: "Szablon ogólny",
  IBKR_FLEX: "Interactive Brokers · Activity Flex Query",
};
const sample =
  "type,occurredOn,currency,amount,ticker,mic,quantity,unitPrice,commission,externalId\r\nDEPOSIT,2025-01-08,PLN,1000,,,,,,cash-1\r\nBUY,2025-01-09,PLN,,CDR,XWAR,2,100,1.99,trade-1\r\n";

export function InvestmentImports({
  portfolioId,
  accountId,
}: {
  portfolioId: string;
  accountId: string;
}) {
  const load = useCallback(
    (signal: AbortSignal) => importApi.list(portfolioId, accountId, signal),
    [portfolioId, accountId],
  );
  const { state, refresh } = useInvestmentResource(load);
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function open(operation: () => Promise<ImportBatch>) {
    setBusy(true);
    setMessage("");
    try {
      setBatch(await operation());
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Nie udało się odczytać partii.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const saved = await open(() =>
      importApi.create(portfolioId, accountId, data),
    );
    if (saved) {
      form.reset();
      refresh();
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="import-title">
      <Link
        href={`/dashboard/investments/${encodeURIComponent(portfolioId)}/accounts/${encodeURIComponent(accountId)}`}
      >
        Wróć do rachunku
      </Link>
      <h1 id="import-title">Import historii</h1>
      <section className={styles.card} aria-labelledby="import-form-title">
        <h2 id="import-form-title">Wczytaj plik CSV</h2>
        <p>
          Sprawdzenie pliku zapisuje partię do podglądu. Stan rachunku zmienia
          się dopiero po zaksięgowaniu operacji.
        </p>
        <a
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(sample)}`}
          download="szablon-importu.csv"
        >
          Pobierz szablon CSV
        </a>
        <form onSubmit={upload}>
          <fieldset className={styles.fields} disabled={busy}>
            <label>
              Format eksportu
              <select name="format">
                {Object.entries(formats).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Plik CSV (do 1 MB)
              <input name="csv" type="file" accept=".csv,text/csv" required />
            </label>
          </fieldset>
          <div>
            <button type="submit" disabled={busy}>
              Sprawdź plik
            </button>
          </div>
        </form>
        {message && (
          <p className={styles.error} role="alert">
            {message}
          </p>
        )}
      </section>
      {batch && (
        <section className={styles.card} aria-labelledby="import-batch-title">
          <h2 id="import-batch-title">Sprawdzona partia</h2>
          <p role="status">
            {batch.status === "PARSED"
              ? "Wiersze przeszły walidację."
              : batch.status === "CONFIRMED"
                ? "Partia zatwierdzona."
                : "Partia zawiera błędy."}{" "}
            Wiersze ({batch.rowCount}) · {batch.encoding}
          </p>
          <ImportPreview
            key={batch.id}
            batch={batch}
            portfolioId={portfolioId}
            accountId={accountId}
          />
        </section>
      )}
      <InvestmentExports portfolioId={portfolioId} accountId={accountId} />
      <section className={styles.card} aria-labelledby="import-history-title">
        <h2 id="import-history-title">Ostatnie partie</h2>
        {state.status === "loading" && <p role="status">Wczytywanie partii…</p>}
        {state.status === "error" && (
          <p role="alert">
            {state.message}{" "}
            <button type="button" onClick={refresh}>
              Ponów odczyt
            </button>
          </p>
        )}
        {state.status === "ready" &&
          (state.value.length ? (
            <ul className={styles.list}>
              {state.value.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void open(() =>
                        importApi.get(portfolioId, accountId, item.id),
                      )
                    }
                  >
                    {formats[item.format as keyof typeof formats] ??
                      item.format}{" "}
                    · {new Date(item.createdAt).toLocaleString("pl-PL")} ·{" "}
                    {item.rowCount}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>Brak zapisanych partii.</p>
          ))}
      </section>
    </section>
  );
}
