"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import {
  type ImportConfirmation,
  type ImportConfirmationInput,
  type ImportPreviewRow,
} from "@/lib/investment-import-api";
import type { InvestmentInstrument } from "@/lib/investments-api";
import { InstrumentPicker } from "./instrument-picker";
import styles from "./investments.module.css";

export function ImportReconciliation({
  result,
}: {
  result: ImportConfirmation;
}) {
  const { asOf, cash, positions } = result.reconciliation;
  return (
    <section aria-labelledby="import-reconciliation-title">
      <h3 id="import-reconciliation-title">Uzgodnienie z dokumentem brokera</h3>
      <p role="status">
        Zaksięgowano {result.posted} operacji. Pominięto {result.skipped.length}
        . Data dokumentu {asOf}.
      </p>
      {cash.length > 0 || positions.length > 0 ? (
        <div className={styles.comparison}>
          <table aria-label="Różnice uzgodnienia">
            <thead>
              <tr>
                <th scope="col">Pozycja</th>
                <th scope="col">Dokument</th>
                <th scope="col">Rachunek</th>
                <th scope="col">Różnica</th>
              </tr>
            </thead>
            <tbody>
              {cash.map((row) => (
                <tr key={row.currency}>
                  <th scope="row">Gotówka {row.currency}</th>
                  <td>{row.expected}</td>
                  <td>{row.actual}</td>
                  <td>{row.difference}</td>
                </tr>
              ))}
              {positions.map((row) => (
                <tr key={row.instrumentId}>
                  <th scope="row">
                    <Link href={`/dashboard/market/${row.instrumentId}`}>
                      Instrument {row.instrumentId.slice(0, 8)}
                    </Link>
                  </th>
                  <td>{row.expected}</td>
                  <td>{row.actual}</td>
                  <td>{row.difference}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>Gotówka i ilości zgadzają się z dokumentem.</p>
      )}
    </section>
  );
}

type BrokerPosition = { instrument: InvestmentInstrument; quantity: string };
const positiveDecimal = /^[0-9]{1,18}([.,][0-9]{1,10})?$/;
const asDecimal = (value: string) => value.trim().replace(",", ".");

export function ImportConfirmationForm({
  rows,
  submit,
  onConfirmed,
}: {
  rows: ImportPreviewRow[];
  submit(data: ImportConfirmationInput): Promise<ImportConfirmation>;
  onConfirmed(result: ImportConfirmation): void;
}) {
  const [range, setRange] = useState("");
  const complete = range === "complete";
  const [positions, setPositions] = useState<BrokerPosition[]>([]);
  const [instrument, setInstrument] = useState<InvestmentInstrument | null>(
    null,
  );
  const [quantity, setQuantity] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const possible = rows.filter((row) => row.duplicate === "POSSIBLE");
  const blocked = rows.some(
    (row) => row.mappingError || row.duplicate === "REPEATED_EXTERNAL_ID",
  );

  function addPosition() {
    if (!instrument || !positiveDecimal.test(quantity.trim())) {
      setError("Wybierz instrument i podaj ilość z dokumentu.");
      return;
    }
    const item = { instrument, quantity: asDecimal(quantity) };
    setPositions((current) => [
      ...current.filter((row) => row.instrument.id !== item.instrument.id),
      item,
    ]);
    setError("");
    setInstrument(null);
    setQuantity("");
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (instrument || quantity) {
      setError("Dodaj wybraną pozycję do listy w dokumencie.");
      return;
    }
    const field = (key: string) => String(data.get(key) ?? "");
    const input: ImportConfirmationInput = {
      completeHistory: complete,
      ...(complete
        ? {}
        : {
            openingOn: field("openingOn"),
            openingEmpty: data.has("openingEmpty"),
          }),
      asOf: field("asOf"),
      cash: { PLN: asDecimal(field("pln")), USD: asDecimal(field("usd")) },
      positions: positions.map((row) => ({
        instrumentId: row.instrument.id,
        quantity: row.quantity,
      })),
      decisions: possible.map((row) => ({
        number: row.number,
        action: field(`decision-${row.number}`) === "KEEP" ? "KEEP" : "SKIP",
      })),
    };
    setBusy(true);
    setError("");
    try {
      onConfirmed(await submit(input));
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Nie udało się zaksięgować partii.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="import-confirmation-title">
      <h3 id="import-confirmation-title">Zatwierdzenie partii</h3>
      {blocked ? (
        <p>Rozwiąż błędy mapowania i identyfikatorów w podglądzie.</p>
      ) : (
        <form onSubmit={confirm} aria-label="Dane dokumentu brokera">
          <fieldset disabled={busy} className={styles.fields}>
            <label>
              Zakres historii
              <select
                required
                value={range}
                onChange={(event) => setRange(event.target.value)}
              >
                <option value="" disabled>
                  Wybierz zakres
                </option>
                <option value="complete">Pełna historia</option>
                <option value="partial">Niepełna historia</option>
              </select>
            </label>
            {range === "partial" && (
              <>
                <label>
                  Data stanu otwarcia
                  <input required type="date" name="openingOn" />
                </label>
                <label className={styles.researchSelection}>
                  <input type="checkbox" name="openingEmpty" /> Zerowa gotówka i
                  brak pozycji w dniu otwarcia
                </label>
                <p className={styles.full}>
                  Stan z wartościami wymaga wierszy gotówkowych lub pozycji
                  otwarcia z kosztem i datą nabycia.
                </p>
              </>
            )}
            <label>
              Data dokumentu brokera
              <input required type="date" name="asOf" />
            </label>
            <label>
              Saldo PLN w dokumencie
              <input
                required
                inputMode="decimal"
                pattern="[0-9]{1,20}([.,][0-9]{1,2})?"
                name="pln"
              />
            </label>
            <label>
              Saldo USD w dokumencie
              <input
                required
                inputMode="decimal"
                pattern="[0-9]{1,20}([.,][0-9]{1,2})?"
                name="usd"
              />
            </label>
          </fieldset>
          <fieldset className={styles.fields} disabled={busy}>
            <legend>Pozycje w dokumencie</legend>
            <InstrumentPicker
              selected={instrument}
              onChange={setInstrument}
              required={false}
            />
            <label>
              Ilość w dokumencie
              <input
                inputMode="decimal"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </label>
            <div className={styles.actions}>
              <button type="button" onClick={addPosition}>
                Dodaj pozycję
              </button>
            </div>
            <ul className={styles.full}>
              {positions.map((row) => (
                <li key={row.instrument.id}>
                  {row.instrument.ticker} · {row.instrument.mic} ·{" "}
                  {row.quantity}{" "}
                  <button
                    type="button"
                    onClick={() =>
                      setPositions((current) =>
                        current.filter((item) => item !== row),
                      )
                    }
                  >
                    Usuń pozycję {row.instrument.ticker}
                  </button>
                </li>
              ))}
            </ul>
          </fieldset>
          {possible.length > 0 && (
            <fieldset className={styles.fields} disabled={busy}>
              <legend>Możliwe duplikaty</legend>
              {possible.map((row) => (
                <label key={row.number}>
                  Decyzja dla wiersza {row.number}
                  <select
                    name={`decision-${row.number}`}
                    required
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Wybierz decyzję
                    </option>
                    <option value="SKIP">Operacja jest już na rachunku</option>
                    <option value="KEEP">To odrębna operacja</option>
                  </select>
                </label>
              ))}
            </fieldset>
          )}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div>
            <button type="submit" disabled={busy}>
              Zatwierdź i zaksięguj
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
