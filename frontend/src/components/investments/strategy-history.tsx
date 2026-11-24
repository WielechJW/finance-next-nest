"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import {
  strategyApi,
  type StrategyReplay,
  type StrategyRun,
} from "@/lib/strategies-api";
import { formatInvestment } from "@/lib/investment-format";
import { useInvestmentResource } from "./use-investment-resource";
import styles from "./investments.module.css";

const reasons: Record<string, string> = {
  CALENDAR_UNAVAILABLE: "Brak obsługi kalendarza giełdy.",
  INSUFFICIENT_HISTORY: "Za mało kolejnych sesji.",
  STALE_PRICE: "Brak kursu z wymaganej sesji.",
  INVALID_PRICE: "Cena w zestawie danych jest nieprawidłowa.",
  SPLIT_IN_LOOKBACK: "W oknie cen wystąpił split.",
  NO_CROSSOVER: "Średnie się nie przecięły.",
  PORTFOLIO_INELIGIBLE: "Stan gotówki lub pozycji wyklucza sygnał.",
  INVALID_PORTFOLIO: "Nieprawidłowy stan rachunku.",
  PORTFOLIO_UNRECONCILED: "Rachunek wymaga uzgodnienia.",
  MARKET_DATA_TIMEOUT: "Dane nie dotarły przed następną sesją.",
  RULE_UNAVAILABLE: "Wersja kodu strategii jest niedostępna.",
};
const dates = new Intl.DateTimeFormat("pl-PL", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Warsaw",
});
const dateTime = (value: string) => dates.format(new Date(value));
function label(decision: StrategyRun["decision"]) {
  return decision.kind === "SIGNAL"
    ? decision.side === "BUY"
      ? "Sygnał kupna"
      : "Sygnał sprzedaży"
    : "Brak sygnału";
}
function reason(decision: StrategyRun["decision"]) {
  return reasons[decision.reason] ?? decision.reason;
}

function Replay({
  replay,
  currency,
}: {
  replay: StrategyReplay;
  currency: string;
}) {
  const { run, computed, parameters, input } = replay;
  const used =
    input?.bars.filter((row) => run.decision.barIds.includes(row.id)) ?? [];
  const decision = computed ?? run.decision;
  return (
    <section aria-labelledby="strategy-replay-title">
      <h3 id="strategy-replay-title">Odtworzenie decyzji</h3>
      <p>
        Wersja {run.version.number} · kod {run.version.codeVersion} ·{" "}
        {dateTime(run.decidedAt)}
      </p>
      <p>
        Średnie z {parameters.fastSessions} i {parameters.slowSessions} sesji ·
        ważność {parameters.validForMinutes} min
      </p>
      <p>
        {label(decision)}. {reason(decision)}
      </p>
      {decision.validUntil && <p>Ważność do {dateTime(decision.validUntil)}</p>}
      {input && (
        <p>
          Gotówka {formatInvestment(input.portfolio.cash, 2)} {currency} · akcje{" "}
          {formatInvestment(input.portfolio.quantity)} · znane operacje{" "}
          {input.eventIds.length}
        </p>
      )}
      {decision.averages && (
        <p>
          Średnie w dniu decyzji {formatInvestment(decision.averages.fast)} i{" "}
          {formatInvestment(decision.averages.slow)} {currency}
        </p>
      )}
      {used.length > 0 && (
        <div className={styles.comparison}>
          <table aria-label="Kursy użyte w decyzji">
            <thead>
              <tr>
                <th scope="col">Sesja</th>
                <th scope="col">Kurs</th>
                <th scope="col">Rewizja</th>
                <th scope="col">Dostępny od</th>
              </tr>
            </thead>
            <tbody>
              {used.map((row) => (
                <tr key={row.id}>
                  <th scope="row">{row.sessionOn}</th>
                  <td>
                    {formatInvestment(row.close)} {currency}
                  </td>
                  <td>{row.revision}</td>
                  <td>{dateTime(row.availableAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const pageSize = 20;
export function StrategyHistory({
  portfolioId,
  accountId,
  strategyId,
  currency,
}: {
  portfolioId: string;
  accountId: string;
  strategyId: string;
  currency: string;
}) {
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [replay, setReplay] = useState<StrategyReplay | null>(null);
  const load = useCallback(
    (signal: AbortSignal) =>
      strategyApi.runs(
        portfolioId,
        accountId,
        strategyId,
        page,
        pageSize,
        signal,
      ),
    [portfolioId, accountId, strategyId, page],
  );
  const { state, refresh } = useInvestmentResource(load);

  async function run(runId?: string) {
    setBusy(true);
    setError("");
    try {
      if (runId) {
        setReplay(
          await strategyApi.replay(portfolioId, accountId, strategyId, runId),
        );
      } else {
        await strategyApi.evaluate(portfolioId, accountId, strategyId);
        setPage(1);
        refresh();
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Nie udało się odczytać decyzji.",
      );
    } finally {
      setBusy(false);
    }
  }

  function turn(next: number) {
    setPage(next);
    refresh();
  }

  return (
    <section className={styles.card} aria-labelledby="strategy-history-title">
      <h2 id="strategy-history-title">Historia decyzji</h2>
      <button type="button" disabled={busy} onClick={() => void run()}>
        Uruchom analizę teraz
      </button>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {state.status === "loading" && (
        <p role="status">Wczytywanie uruchomień…</p>
      )}
      {state.status === "error" && (
        <p role="alert">
          {state.message}{" "}
          <button type="button" onClick={refresh}>
            Ponów odczyt
          </button>
        </p>
      )}
      {state.status === "ready" && (
        <>
          {state.value.length ? (
            <div className={styles.comparison}>
              <table aria-label="Uruchomienia strategii">
                <thead>
                  <tr>
                    <th scope="col">Decyzja</th>
                    <th scope="col">Wersja</th>
                    <th scope="col">Wynik</th>
                    <th scope="col">Szczegóły</th>
                  </tr>
                </thead>
                <tbody>
                  {state.value.map((row) => (
                    <tr key={row.id}>
                      <th scope="row">
                        <time dateTime={row.decidedAt}>
                          {dateTime(row.decidedAt)}
                        </time>
                      </th>
                      <td>{row.version.number}</td>
                      <td>
                        <span>{label(row.decision)}</span>
                        <small>{reason(row.decision)}</small>
                      </td>
                      <td>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void run(row.id)}
                        >
                          Odtwórz decyzję
                        </button>
                        {row.signalId &&
                          row.decision.validUntil &&
                          new Date(row.decision.validUntil) > new Date() && (
                            <p>
                              <Link
                                href={`/dashboard/investments/paper?signal=${encodeURIComponent(row.signalId)}`}
                              >
                                Przenieś sygnał do symulatora
                              </Link>
                            </p>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>
              {page === 1
                ? "Brak uruchomień tej strategii."
                : "Brak kolejnych uruchomień."}
            </p>
          )}
          {(page > 1 || state.value.length === pageSize) && (
            <div className={styles.actions}>
              <button
                type="button"
                disabled={page === 1}
                onClick={() => turn(page - 1)}
              >
                Poprzednia strona
              </button>
              <button
                type="button"
                disabled={state.value.length < pageSize}
                onClick={() => turn(page + 1)}
              >
                Następna strona
              </button>
            </div>
          )}
        </>
      )}
      {replay && <Replay replay={replay} currency={currency} />}
    </section>
  );
}
