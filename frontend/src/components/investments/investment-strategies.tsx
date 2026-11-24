"use client";

import Link from "next/link";
import { useCallback, useState, type FormEvent } from "react";
import type { InvestmentInstrument } from "@/lib/investments-api";
import {
  strategyApi,
  type Strategy,
  type StrategyParameters,
} from "@/lib/strategies-api";
import { BacktestPanel } from "./backtest-panel";
import { InstrumentPicker } from "./instrument-picker";
import { StrategyHistory } from "./strategy-history";
import { useInvestmentResource } from "./use-investment-resource";
import styles from "./investments.module.css";

type Account = { portfolioId: string; accountId: string };
const defaults: StrategyParameters = {
  fastSessions: 5,
  slowSessions: 20,
  validForMinutes: 60,
};
const parameters = (data: FormData): StrategyParameters => ({
  fastSessions: Number(data.get("fastSessions")),
  slowSessions: Number(data.get("slowSessions")),
  validForMinutes: Number(data.get("validForMinutes")),
});

function ParameterFields({ values }: { values: StrategyParameters }) {
  return (
    <>
      <label>
        Szybka średnia (sesje)
        <input
          type="number"
          min={2}
          max={249}
          name="fastSessions"
          defaultValue={values.fastSessions}
          required
        />
      </label>
      <label>
        Długa średnia (sesje)
        <input
          type="number"
          min={3}
          max={250}
          name="slowSessions"
          defaultValue={values.slowSessions}
          required
        />
      </label>
      <label>
        Ważność sygnału (minuty)
        <input
          type="number"
          min={1}
          max={1440}
          name="validForMinutes"
          defaultValue={values.validForMinutes}
          required
        />
      </label>
    </>
  );
}

function NewStrategy({
  portfolioId,
  accountId,
  onCreated,
}: Account & { onCreated(strategy: Strategy): void }) {
  const [instrument, setInstrument] = useState<InvestmentInstrument | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!instrument || busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError("");
    try {
      const saved = await strategyApi.create(
        portfolioId,
        accountId,
        String(data.get("name")),
        instrument.id,
        parameters(data),
      );
      form.reset();
      setInstrument(null);
      onCreated(saved);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Nie udało się dodać strategii.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.card} aria-labelledby="new-strategy-title">
      <h2 id="new-strategy-title">Nowa strategia SMA</h2>
      <form onSubmit={create} aria-label="Nowa strategia SMA">
        <fieldset disabled={busy} className={styles.fields}>
          <label>
            Nazwa strategii
            <input name="name" maxLength={100} required />
          </label>
          <InstrumentPicker selected={instrument} onChange={setInstrument} />
          <ParameterFields values={defaults} />
        </fieldset>
        <div>
          <button type="submit" disabled={busy}>
            Dodaj strategię
          </button>
        </div>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </form>
    </section>
  );
}

function SelectedStrategy({
  portfolioId,
  accountId,
  strategy,
  onChanged,
}: Account & { strategy: Strategy; onChanged(message: string): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(change: () => Promise<unknown>, message: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await change();
      onChanged(message);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Nie udało się zapisać zmian.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section
        className={styles.card}
        aria-labelledby="selected-strategy-title"
      >
        <h2 id="selected-strategy-title">{strategy.name}</h2>
        <p>
          {strategy.instrument.ticker} · {strategy.instrument.mic} · wersja{" "}
          {strategy.version.number}
        </p>
        <form
          aria-label="Parametry strategii"
          onSubmit={(event) => {
            event.preventDefault();
            const values = parameters(new FormData(event.currentTarget));
            void save(
              () =>
                strategyApi.revise(portfolioId, accountId, strategy.id, values),
              "Zapisano parametry strategii.",
            );
          }}
        >
          <fieldset className={styles.fields} disabled={busy}>
            <ParameterFields values={strategy.version.parameters} />
          </fieldset>
          <div>
            <button type="submit" disabled={busy}>
              Zapisz parametry
            </button>
          </div>
        </form>
        <form
          aria-label="Harmonogram strategii"
          onSubmit={(event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            const enabled = values.has("enabled");
            const notifyOnSignal = values.has("notify");
            void save(
              () =>
                strategyApi.schedule(
                  portfolioId,
                  accountId,
                  strategy.id,
                  enabled,
                  notifyOnSignal,
                ),
              enabled ? "Włączono harmonogram." : "Wyłączono harmonogram.",
            );
          }}
        >
          <fieldset className={styles.fields} disabled={busy}>
            <label className={styles.researchSelection}>
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={strategy.enabled}
              />{" "}
              Automatyczne uruchomienia
            </label>
            <label className={styles.researchSelection}>
              <input
                type="checkbox"
                name="notify"
                defaultChecked={strategy.notifyOnSignal}
              />{" "}
              Powiadomienia Telegram
            </label>
          </fieldset>
          <div>
            <button type="submit" disabled={busy}>
              Zapisz harmonogram
            </button>
          </div>
        </form>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </section>
      <StrategyHistory
        portfolioId={portfolioId}
        accountId={accountId}
        strategyId={strategy.id}
        currency={strategy.instrument.currency}
      />
      <BacktestPanel
        portfolioId={portfolioId}
        accountId={accountId}
        strategyId={strategy.id}
      />{" "}
    </>
  );
}

export function InvestmentStrategies({ portfolioId, accountId }: Account) {
  const load = useCallback(
    (signal: AbortSignal) => strategyApi.list(portfolioId, accountId, signal),
    [portfolioId, accountId],
  );
  const { state, refresh } = useInvestmentResource(load);
  const [selected, setSelected] = useState<string>("");
  const [notice, setNotice] = useState("");
  const strategies = state.status === "ready" ? state.value : [];
  const active =
    strategies.find((item) => item.id === selected) ?? strategies[0];

  return (
    <section
      className={styles.panel}
      aria-labelledby="investment-strategies-title"
    >
      <Link
        href={`/dashboard/investments/${encodeURIComponent(portfolioId)}/accounts/${encodeURIComponent(accountId)}`}
      >
        Wróć do rachunku
      </Link>
      <h1 id="investment-strategies-title">Strategie sygnałowe</h1>
      <NewStrategy
        portfolioId={portfolioId}
        accountId={accountId}
        onCreated={(strategy) => {
          setSelected(strategy.id);
          setNotice("Dodano strategię.");
          refresh();
        }}
      />
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      {state.status === "loading" && (
        <p role="status">Wczytywanie strategii…</p>
      )}
      {state.status === "error" && (
        <p role="alert">
          {state.message}{" "}
          <button type="button" onClick={refresh}>
            Ponów odczyt
          </button>
        </p>
      )}
      {state.status === "ready" && !active && (
        <p>Brak zapisanych strategii na tym rachunku.</p>
      )}
      {active && (
        <>
          <section className={styles.card}>
            <label>
              Wybierz strategię
              <select
                value={active.id}
                onChange={(event) => {
                  setSelected(event.target.value);
                  setNotice("");
                }}
              >
                {strategies.map((strategy) => (
                  <option key={strategy.id} value={strategy.id}>
                    {strategy.name} · {strategy.instrument.ticker}
                  </option>
                ))}
              </select>
            </label>
          </section>
          <SelectedStrategy
            key={active.id}
            portfolioId={portfolioId}
            accountId={accountId}
            strategy={active}
            onChanged={(message) => {
              setNotice(message);
              refresh();
            }}
          />
        </>
      )}
    </section>
  );
}
