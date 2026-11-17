"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiError, isAbortError } from "@/lib/api-client";
import {
  investmentInput,
  investmentSourceInstant,
} from "@/lib/investment-format";
import {
  investmentsApi,
  type InvestmentEvent,
  type InvestmentInstrument,
  type ManualInvestmentInput,
} from "@/lib/investments-api";
import { isCalendarDate, warsawToday } from "@/lib/transaction-input";
import styles from "./investments.module.css";

export const investmentLabels: Record<string, string> = {
  DEPOSIT: "Wpłata",
  WITHDRAWAL: "Wypłata",
  BUY: "Zakup",
  SELL: "Sprzedaż",
  FEE: "Opłata",
  DIVIDEND: "Dywidenda",
  FX: "Wymiana walut",
  OPENING_POSITION: "Pozycja otwarcia",
  CORRECTION: "Anulowanie",
};

export function InvestmentForm({
  portfolioId,
  accountId,
  instruments,
  sequence,
  selection,
  onSaved,
  onCancel,
}: {
  portfolioId: string;
  accountId: string;
  instruments: InvestmentInstrument[];
  sequence: number;
  selection?: InvestmentEvent;
  onSaved(): void;
  onCancel?(): void;
}) {
  const hintId = useId();
  const [type, setType] = useState<ManualInvestmentInput["type"]>(
    (selection?.type as ManualInvestmentInput["type"]) ?? "DEPOSIT",
  );
  const [date, setDate] = useState(selection?.occurredOn ?? warsawToday());
  const [order, setOrder] = useState(
    String(selection?.daySequence ?? sequence),
  );
  const [currency, setCurrency] = useState<"PLN" | "USD">(
    (selection?.cashEntries[0]?.currency as "PLN" | "USD") ?? "PLN",
  );
  const [amount, setAmount] = useState(
    selection?.cashEntries.find((e) => e.kind === "EXTERNAL_TRANSFER")
      ?.amount ?? "",
  );
  const [instrumentId, setInstrumentId] = useState(
    selection?.trade?.instrument.id ?? instruments[0]?.id ?? "",
  );
  const [quantity, setQuantity] = useState(selection?.trade?.quantity ?? "");
  const [price, setPrice] = useState(selection?.trade?.unitPrice ?? "");
  const [commission, setCommission] = useState(
    selection?.cashEntries
      .find((e) => e.kind === "COMMISSION")
      ?.amount.replace(/^-/, "") ?? "0",
  );
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const locked = useRef(false);
  const pending = useRef<{
    input: ManualInvestmentInput;
    reason: string;
  } | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (locked.current) return;
    setError("");
    try {
      if (!pending.current) {
        if (!isCalendarDate(date) || date > warsawToday())
          throw new Error(
            "Wybierz istniejącą datę, nie późniejszą niż dzisiaj.",
          );
        if (!/^[1-9]\d*$/.test(order) || Number(order) > 2147483647)
          throw new Error(
            "Kolejność w dniu musi być dodatnią liczbą całkowitą.",
          );
        if (selection && !reason.trim())
          throw new Error("Podaj powód korekty.");
        const common = {
          type,
          occurredOn: date,
          daySequence: Number(order),
          timePrecision: selection?.timePrecision ?? ("DATE" as const),
          idempotencyKey: crypto.randomUUID(),
          ...(selection?.timePrecision === "INSTANT" &&
          selection.executedAt &&
          selection.sourceTimeZone
            ? {
                executedAt: investmentSourceInstant(
                  selection.executedAt,
                  selection.sourceTimeZone,
                ),
                sourceTimeZone: selection.sourceTimeZone,
              }
            : {}),
          ...(selection?.marketSessionOn
            ? { marketSessionOn: selection.marketSessionOn }
            : {}),
          ...(selection?.settledOn ? { settledOn: selection.settledOn } : {}),
        };
        const input: ManualInvestmentInput =
          type === "DEPOSIT"
            ? { ...common, currency, amount: investmentInput(amount, 2) }
            : {
                ...common,
                instrumentId,
                quantity: investmentInput(quantity, 10),
                unitPrice: investmentInput(price, 10),
                commission: investmentInput(commission, 2, true),
              };
        if (
          type !== "DEPOSIT" &&
          !instruments.some((item) => item.id === instrumentId)
        )
          throw new Error("Wybierz instrument z katalogu.");
        pending.current = { input, reason: reason.trim() };
      }
      locked.current = true;
      setBusy(true);
      const controller = new AbortController();
      request.current = controller;
      const saved = pending.current;
      if (selection) {
        await investmentsApi.correct(
          portfolioId,
          accountId,
          selection.id,
          {
            expectedRevision: selection.revision,
            idempotencyKey: saved.input.idempotencyKey,
            reason: saved.reason,
            replacement: saved.input,
          },
          controller.signal,
        );
      } else
        await investmentsApi.post(
          portfolioId,
          accountId,
          saved.input,
          controller.signal,
        );
      pending.current = null;
      setUncertain(false);
      onSaved();
    } catch (failure) {
      if (isAbortError(failure)) return;
      const unknownResult =
        failure instanceof ApiError &&
        (failure.status === 0 || failure.status >= 500);
      setUncertain(unknownResult);
      if (!unknownResult) pending.current = null;
      setError(
        unknownResult
          ? "Nie udało się potwierdzić zapisu. Ponów ten sam zapis, aby sprawdzić jego wynik bez powielania operacji."
          : failure instanceof Error
            ? failure.message
            : "Nie udało się zapisać operacji.",
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  return (
    <form
      aria-label={selection ? "Korekta operacji" : "Nowa operacja inwestycyjna"}
      onSubmit={(event) => void submit(event)}
      className={styles.card}
      aria-busy={busy}
    >
      <h2>{selection ? "Korekta operacji" : "Dodaj operację"}</h2>
      <fieldset disabled={busy || uncertain} className={styles.fields}>
        <legend className={styles.srOnly}>Dane operacji</legend>
        <label>
          Typ operacji
          <select
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
            disabled={!!selection}
          >
            {["DEPOSIT", "BUY", "SELL"].map((value) => (
              <option key={value} value={value}>
                {investmentLabels[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Data operacji
          <input
            type="date"
            value={date}
            max={warsawToday()}
            onChange={(e) => setDate(e.target.value)}
            disabled={selection?.timePrecision === "INSTANT"}
            required
          />
        </label>
        <label>
          Kolejność w dniu
          <input
            inputMode="numeric"
            value={order}
            onChange={(e) => setOrder(e.target.value)}
            required
            aria-describedby={hintId}
          />
        </label>
        {type === "DEPOSIT" ? (
          <>
            <label>
              Waluta
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as typeof currency)}
              >
                <option>PLN</option>
                <option>USD</option>
              </select>
            </label>
            <label>
              Kwota
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </label>
          </>
        ) : (
          <>
            <label>
              Instrument
              <select
                value={instrumentId}
                onChange={(e) => setInstrumentId(e.target.value)}
                required
              >
                <option value="">Wybierz instrument</option>
                {instruments.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.ticker} · {item.mic} · {item.currency}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Ilość akcji
              <input
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
              />
            </label>
            <label>
              Cena za akcję
              <input
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                required
              />
            </label>
            <label>
              Prowizja
              <input
                inputMode="decimal"
                value={commission}
                onChange={(e) => setCommission(e.target.value)}
                required
              />
            </label>
          </>
        )}
        {selection && (
          <label className={styles.full}>
            Powód korekty
            <input
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </label>
        )}
      </fieldset>
      <p id={hintId} className={styles.hint}>
        Kolejność określa porządek operacji tego samego dnia. Cena i prowizja są
        w walucie instrumentu.
      </p>
      {type !== "DEPOSIT" && instruments.length === 0 && (
        <p role="status">
          Katalog instrumentów jest pusty. Możesz zapisać wpłatę.
        </p>
      )}
      <p role="alert" className={styles.error}>
        {error}
      </p>
      <div className={styles.actions}>
        <button type="submit" disabled={busy}>
          {busy
            ? "Zapisywanie…"
            : uncertain
              ? "Ponów ten sam zapis"
              : selection
                ? "Zapisz korektę"
                : "Zapisz operację"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy || uncertain}>
            Anuluj edycję
          </button>
        )}
      </div>
    </form>
  );
}
