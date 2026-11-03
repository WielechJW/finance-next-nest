"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, isAbortError } from "@/lib/api-client";
import { formatPLN, normalizeMoneyInput } from "@/lib/money";
import { walletApi } from "@/lib/wallet-api";
import type { UpdateWalletInput, WalletDto } from "@/lib/wallet-types";
import { useSession } from "./session-provider";
import styles from "./wallet-panel.module.css";

type WalletState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; wallet: WalletDto };
type FieldErrors = { name?: string; openingBalance?: string };

function moneyInput(value: string): string {
  return value.replace(".", ",");
}

export function WalletPanel() {
  const { state } = useSession();
  const [attempt, setAttempt] = useState(0);
  if (state.status !== "authenticated") return null;
  return (
    <WalletContent
      key={`${state.user.id}:${attempt}`}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  );
}

function WalletContent({ onRetry }: { onRetry: () => void }) {
  const [state, setState] = useState<WalletState>({ status: "loading" });
  const [name, setName] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const saveController = useRef<AbortController | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const balanceInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void walletApi.get(controller.signal).then(
      (wallet) => {
        if (controller.signal.aborted) return;
        setState({ status: "ready", wallet });
        setName(wallet.name);
        setOpeningBalance(moneyInput(wallet.openingBalance));
      },
      (error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        if (error instanceof ApiError && error.status === 401) return;
        setState({
          status: "error",
          message:
            error instanceof ApiError
              ? error.message
              : "Nie udało się pobrać portfela. Spróbuj ponownie.",
        });
      },
    );
    return () => {
      controller.abort();
      saveController.current?.abort();
    };
  }, []);

  let normalizedBalance: string | undefined;
  try {
    normalizedBalance = normalizeMoneyInput(openingBalance);
  } catch {
    // Validation messages appear after submitting, while typing stays unrestricted.
  }
  const changed =
    state.status === "ready" &&
    (name.trim() !== state.wallet.name ||
      normalizedBalance !== state.wallet.openingBalance);

  function clearFeedback(field: keyof FieldErrors) {
    setErrors((previous) => ({ ...previous, [field]: undefined }));
    setSaveError("");
    setNotice("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || state.status !== "ready") return;
    const nextErrors: FieldErrors = {};
    const trimmedName = name.trim();
    if (
      Array.from(trimmedName).length < 1 ||
      Array.from(trimmedName).length > 100
    ) {
      nextErrors.name = "Nazwa portfela musi mieć od 1 do 100 znaków.";
    }
    let amount: string | undefined;
    try {
      amount = normalizeMoneyInput(openingBalance);
    } catch (error) {
      nextErrors.openingBalance =
        error instanceof Error ? error.message : "Podaj poprawną kwotę.";
    }
    setErrors(nextErrors);
    setSaveError("");
    setNotice("");
    if (nextErrors.name || nextErrors.openingBalance) {
      (nextErrors.name ? nameInput : balanceInput).current?.focus();
      return;
    }

    const input: UpdateWalletInput = {};
    if (trimmedName !== state.wallet.name) input.name = trimmedName;
    if (amount !== state.wallet.openingBalance) input.openingBalance = amount;
    if (!Object.keys(input).length) return;

    pending.current = true;
    setSaving(true);
    const controller = new AbortController();
    saveController.current = controller;
    try {
      const wallet = await walletApi.update(input, controller.signal);
      if (controller.signal.aborted) return;
      setState({ status: "ready", wallet });
      setName(wallet.name);
      setOpeningBalance(moneyInput(wallet.openingBalance));
      setNotice("Zmiany zapisane.");
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) return;
      if (error instanceof ApiError && error.status === 401) return;
      setSaveError(
        error instanceof ApiError
          ? error.message
          : "Nie udało się zapisać zmian. Spróbuj ponownie.",
      );
    } finally {
      pending.current = false;
      if (!controller.signal.aborted) setSaving(false);
      if (saveController.current === controller) saveController.current = null;
    }
  }

  if (state.status === "loading") {
    return (
      <section aria-labelledby="wallet-loading-heading">
        <h1 id="wallet-loading-heading">Twój portfel</h1>
        <p role="status">Ładowanie portfela…</p>
      </section>
    );
  }
  if (state.status === "error") {
    return (
      <section aria-labelledby="wallet-error-heading">
        <h1 id="wallet-error-heading">Twój portfel</h1>
        <p role="alert">{state.message}</p>
        <button type="button" onClick={onRetry}>
          Spróbuj ponownie
        </button>
      </section>
    );
  }

  const { wallet } = state;
  return (
    <section className={styles.panel} aria-labelledby="wallet-heading">
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>Twój portfel</p>
          <h1 id="wallet-heading">{wallet.name}</h1>
        </div>
        <span className={styles.currency} aria-label="Waluta: PLN">
          PLN
        </span>
      </header>

      <section aria-label="Podsumowanie portfela">
        <dl className={styles.balances}>
          <div className={styles.currentBalance}>
            <dt>Bieżące saldo</dt>
            <dd>{formatPLN(wallet.balance)}</dd>
          </div>
          <div>
            <dt>Saldo początkowe</dt>
            <dd>{formatPLN(wallet.openingBalance)}</dd>
          </div>
        </dl>
        {wallet.openingBalance === "0.00" && (
          <p className={styles.welcome}>
            Możesz ustawić saldo początkowe swojego portfela.
          </p>
        )}
      </section>

      <section
        className={styles.settings}
        aria-labelledby="wallet-settings-heading"
      >
        <h2 id="wallet-settings-heading">Ustawienia portfela</h2>
        <p>
          Saldo początkowe to kwota, od której zaczynasz prowadzenie portfela.
          Może być również ujemne.
        </p>
        <form
          className={styles.form}
          onSubmit={submit}
          noValidate
          aria-busy={saving}
          aria-labelledby="wallet-settings-heading"
        >
          <div className={styles.fields}>
            <div className={styles.field}>
              <label htmlFor="wallet-name">Nazwa portfela</label>
              <input
                ref={nameInput}
                id="wallet-name"
                name="name"
                type="text"
                required
                value={name}
                disabled={saving}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? "wallet-name-error" : undefined}
                onChange={(event) => {
                  setName(event.target.value);
                  clearFeedback("name");
                }}
              />
              {errors.name && (
                <p id="wallet-name-error" className={styles.error}>
                  {errors.name}
                </p>
              )}
            </div>
            <div className={styles.field}>
              <label htmlFor="wallet-opening-balance">Saldo początkowe</label>
              <input
                ref={balanceInput}
                id="wallet-opening-balance"
                name="openingBalance"
                type="text"
                inputMode="decimal"
                required
                value={openingBalance}
                disabled={saving}
                aria-invalid={Boolean(errors.openingBalance)}
                aria-describedby={`wallet-balance-help${errors.openingBalance ? " wallet-balance-error" : ""}`}
                onChange={(event) => {
                  setOpeningBalance(event.target.value);
                  clearFeedback("openingBalance");
                }}
              />
              <p id="wallet-balance-help" className={styles.hint}>
                Kwota w PLN. Możesz użyć przecinka, np. -250,50.
              </p>
              {errors.openingBalance && (
                <p id="wallet-balance-error" className={styles.error}>
                  {errors.openingBalance}
                </p>
              )}
            </div>
          </div>
          <div role="alert" aria-atomic="true">
            {(errors.name || errors.openingBalance) && (
              <p className={styles.error}>Popraw zaznaczone pola.</p>
            )}
            {saveError && <p className={styles.error}>{saveError}</p>}
          </div>
          <div className={styles.actions}>
            <button type="submit" disabled={saving || !changed}>
              {saving ? "Zapisywanie…" : "Zapisz zmiany"}
            </button>
            <div role="status" aria-atomic="true">
              {notice && <p className={styles.success}>{notice}</p>}
            </div>
          </div>
        </form>
      </section>
    </section>
  );
}
