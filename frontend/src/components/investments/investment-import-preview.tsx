"use client";

import { useCallback, useState, type FormEvent } from "react";
import {
  importApi,
  type ImportBatch,
  type ImportPreviewRow,
  type ImportConfirmation,
} from "@/lib/investment-import-api";
import type { InvestmentInstrument } from "@/lib/investments-api";
import {
  ImportConfirmationForm,
  ImportReconciliation,
} from "./investment-import-confirmation";
import { InstrumentPicker } from "./instrument-picker";
import { useInvestmentResource } from "./use-investment-resource";
import styles from "./investments.module.css";

const detailLabels: Record<string, string> = {
  amount: "Kwota",
  currency: "Waluta",
  quantity: "Ilość",
  unitPrice: "Cena jednostkowa",
  commission: "Prowizja",
  grossAmount: "Kwota brutto",
  withholdingTax: "Podatek",
  fee: "Opłata",
  soldCurrency: "Waluta sprzedawana",
  boughtCurrency: "Waluta kupowana",
  soldAmount: "Kwota sprzedana",
  boughtAmount: "Kwota kupiona",
  totalCost: "Koszt otwarcia",
  numerator: "Licznik splitu",
  denominator: "Mianownik splitu",
};
const duplicateLabels: Record<string, string> = {
  ALREADY_IMPORTED: "Identyfikator był już importowany.",
  REPEATED_EXTERNAL_ID: "Identyfikator występuje kilka razy w pliku.",
  POSSIBLE:
    "Możliwy duplikat operacji z rachunku. Sprawdź przed zatwierdzeniem.",
};
const pageSize = 25;

function MappingForm({
  row,
  save,
  close,
}: {
  row: ImportPreviewRow;
  save(instrumentId: string | null): Promise<void>;
  close(): void;
}) {
  const [selected, setSelected] = useState<InvestmentInstrument | null>(
    row.instrument,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await save(selected?.id ?? null);
      close();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Nie udało się zapisać mapowania.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} aria-label={`Instrument dla wiersza ${row.number}`}>
      <fieldset className={styles.fields} disabled={busy}>
        <InstrumentPicker
          selected={selected}
          onChange={setSelected}
          required={false}
        />
      </fieldset>
      <div className={styles.actions}>
        <button type="submit" disabled={busy}>
          Zapisz mapowanie
        </button>
        <button type="button" onClick={close} disabled={busy}>
          Anuluj
        </button>
      </div>
      {message && <p role="alert">{message}</p>}
    </form>
  );
}

export function ImportPreview({
  batch,
  portfolioId,
  accountId,
}: {
  batch: ImportBatch;
  portfolioId: string;
  accountId: string;
}) {
  const [showFrom, setShowFrom] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  const [confirmation, setConfirmation] = useState<ImportConfirmation | null>(
    batch.confirmation,
  );
  const load = useCallback(
    (signal: AbortSignal) =>
      importApi.preview(portfolioId, accountId, batch.id, signal),
    [portfolioId, accountId, batch.id],
  );
  const { state, refresh } = useInvestmentResource(load);
  const rows = new Map(
    state.status === "ready" ? state.value.map((row) => [row.number, row]) : [],
  );
  const active = editing === null ? undefined : rows.get(editing);

  return (
    <>
      {state.status === "loading" && (
        <p role="status">Porównywanie z rachunkiem…</p>
      )}
      {state.status === "error" && (
        <p role="alert">
          {state.message}{" "}
          <button type="button" onClick={refresh}>
            Ponów podgląd
          </button>
        </p>
      )}
      {active && (
        <MappingForm
          key={active.number}
          row={active}
          close={() => setEditing(null)}
          save={async (instrumentId) => {
            await importApi.map(
              portfolioId,
              accountId,
              batch.id,
              active.number,
              instrumentId,
            );
            refresh();
          }}
        />
      )}
      <div className={styles.comparison}>
        <table aria-label="Wiersze partii">
          <thead>
            <tr>
              <th scope="col">Wiersz</th>
              <th scope="col">Operacja</th>
              <th scope="col">Wartości</th>
              <th scope="col">Wynik sprawdzenia</th>
            </tr>
          </thead>
          <tbody>
            {batch.rows.slice(showFrom, showFrom + pageSize).map((row) => {
              const check = rows.get(row.number);
              return (
                <tr key={row.number}>
                  <th scope="row">{row.number}</th>
                  <td>
                    {row.data &&
                      [
                        row.data.type,
                        row.data.occurredOn,
                        row.data.ticker ?? row.data.isin,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                  </td>
                  <td>
                    {check &&
                      Object.entries(check.details).map(([key, value]) => (
                        <small key={key}>
                          {detailLabels[key] ?? key} {value}
                        </small>
                      ))}
                  </td>
                  <td>
                    {row.error && <p>{row.error}</p>}
                    {check?.instrument && (
                      <p>
                        {check.instrument.ticker} · {check.instrument.mic} ·{" "}
                        {check.instrument.currency}
                      </p>
                    )}
                    {check?.mappingError && <p>{check.mappingError}</p>}
                    {check?.duplicate && (
                      <p>{duplicateLabels[check.duplicate]}</p>
                    )}
                    {check && !check.mappingError && !check.duplicate && (
                      <p>Poprawny format</p>
                    )}
                    {!confirmation && check?.needsInstrument && (
                      <button
                        type="button"
                        onClick={() => setEditing(row.number)}
                        aria-label={`Mapuj instrument w wierszu ${row.number}`}
                      >
                        Mapuj instrument
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {batch.rows.length > pageSize && (
        <div className={styles.actions}>
          <button
            type="button"
            disabled={showFrom === 0}
            onClick={() => setShowFrom((offset) => offset - pageSize)}
          >
            Poprzednie wiersze
          </button>
          <button
            type="button"
            disabled={showFrom + pageSize >= batch.rows.length}
            onClick={() => setShowFrom((offset) => offset + pageSize)}
          >
            Następne wiersze
          </button>
        </div>
      )}
      {confirmation ? (
        <ImportReconciliation result={confirmation} />
      ) : (
        batch.status === "PARSED" &&
        state.status === "ready" && (
          <ImportConfirmationForm
            rows={state.value}
            submit={(input) =>
              importApi.confirm(portfolioId, accountId, batch.id, input)
            }
            onConfirmed={setConfirmation}
          />
        )
      )}
    </>
  );
}
