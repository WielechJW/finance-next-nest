"use client";

import { useState, type FormEvent } from "react";
import { apiRequest } from "@/lib/api-client";
import { investmentAccountPath } from "@/lib/investments-api";
import styles from "./investments.module.css";

const formats = {
  operations: "Operacje do ponownego importu",
  positions: "Pozycje i wycena",
  results: "Wyniki i gotówka",
  audit: "Historia zmian",
};

export function InvestmentExports({
  portfolioId,
  accountId,
}: {
  portfolioId: string;
  accountId: string;
}) {
  const [kind, setKind] = useState<keyof typeof formats>("operations");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const history = kind === "operations" || kind === "audit";

  async function download(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const asOf = String(data.get("asOf") ?? "");
    const query = new URLSearchParams({ kind, asOf });
    if (history && data.get("from"))
      query.set("from", String(data.get("from")));
    setBusy(true);
    setError("");
    try {
      const blob = await apiRequest<Blob>(
        `${investmentAccountPath(portfolioId, accountId)}/exports?${query}`,
        {
          responseType: "blob",
          headers: { Accept: "text/csv" },
          timeoutMs: 30000,
        },
      );
      if (!blob.type.startsWith("text/csv"))
        throw new Error("Serwer zwrócił inny format niż CSV.");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `finance-${kind}-${asOf}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Nie udało się pobrać pliku.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.card} aria-labelledby="investment-exports-title">
      <h2 id="investment-exports-title">Eksportuj CSV</h2>
      <form onSubmit={download} aria-label="Eksportuj CSV">
        <fieldset className={styles.fields} disabled={busy}>
          <label>
            Zawartość pliku
            <select
              value={kind}
              onChange={(event) =>
                setKind(event.target.value as keyof typeof formats)
              }
            >
              {Object.entries(formats).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {history ? "Do dnia" : "Data wyceny"}
            <input type="date" name="asOf" required />
          </label>
          {history && (
            <label>
              Od dnia
              <input type="date" name="from" />
            </label>
          )}
        </fieldset>
        <div>
          <button type="submit" disabled={busy}>
            {busy ? "Przygotowywanie pliku…" : "Pobierz CSV"}
          </button>
        </div>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
