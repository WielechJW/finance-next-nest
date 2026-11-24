"use client";

import { useCallback, useState, type FormEvent } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { backtestsApi, type BacktestDetail } from "@/lib/backtests-api";
import { formatInvestment } from "@/lib/investment-format";
import { useInvestmentResource } from "./use-investment-resource";
import styles from "./investments.module.css";

const metrics = [
  { name: "Kapitał początkowy", key: "initialCapital", type: "currency" },
  { name: "Kapitał końcowy", key: "finalCapital", type: "currency" },
  { name: "Wynik po kosztach", key: "profit", type: "currency" },
  { name: "Maksymalne obsunięcie", key: "maxDrawdownPercent", type: "%" },
  { name: "Średnia ekspozycja", key: "averageExposurePercent", type: "%" },
  { name: "Obrót", key: "turnover", type: "currency" },
  { name: "Liczba transakcji", key: "executedTrades", type: "count" },
] as const;
const phase = (value: string) =>
  value === "DEVELOPMENT" ? "Dobór parametrów" : "Poza próbą";

function Report({ result }: { result: BacktestDetail }) {
  const { report } = result;
  function metric(
    value: string | number | null,
    type: (typeof metrics)[number]["type"],
  ) {
    if (value === null) return "Brak danych";
    if (typeof value === "number") return value.toLocaleString("pl-PL");
    return `${formatInvestment(value)} ${type === "currency" ? report?.currency : "%"}`;
  }
  const points = report?.strategy.curve.map((point, index) => ({
    sessionOn: point.sessionOn,
    strategy: point.capital === null ? null : Number(point.capital),
    passive:
      report.benchmark.curve[index]?.capital == null
        ? null
        : Number(report.benchmark.curve[index].capital),
  }));
  return (
    <section aria-labelledby="backtest-report-title">
      <h3 id="backtest-report-title">Raport próby</h3>
      <p>
        {phase(result.phase)} · {result.fromOn} – {result.toOn} · wersja reguły{" "}
        {result.version} · model {result.modelVersion}
      </p>
      {result.error && (
        <p role="status">Próba zakończona błędem. {result.error}</p>
      )}
      {report && (
        <>
          <div className={styles.comparison}>
            <table aria-label="Wyniki strategii i benchmarku">
              <thead>
                <tr>
                  <th scope="col">Wskaźnik</th>
                  <th scope="col">Strategia</th>
                  <th scope="col">Kup i trzymaj</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">{row.name}</th>
                    <td>{metric(report.strategy[row.key], row.type)}</td>
                    <td>{metric(report.benchmark[row.key], row.type)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(!report.strategy.complete || !report.benchmark.complete) && (
            <p>
              Wejście jest niepełne. W krzywej brakuje części wartości rynkowych
              lub przeliczeń walutowych.
            </p>
          )}
          <figure aria-label="Krzywa kapitału strategii i benchmarku">
            <figcaption>Kapitał w {report.currency}</figcaption>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={points}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="sessionOn" />
                <YAxis width={70} />
                <Tooltip />
                <Legend />
                <Line
                  type="linear"
                  dataKey="strategy"
                  name="Strategia"
                  stroke="#246248"
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="linear"
                  dataKey="passive"
                  name="Kup i trzymaj"
                  stroke="#625291"
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </figure>
          <p>
            Ceny {report.priceBasis === "RAW" ? "surowe" : "skorygowane"} ·
            stała ilość {String(report.assumptions.orderQuantity)} · kolejne
            otwarcie · limit {String(report.assumptions.maxWaitSessions)} sesji.
          </p>
          <p>
            Prowizja stała {String(report.costs.commissionFixed)} w walucie
            instrumentu · prowizja {String(report.costs.commissionBps)} pb ·
            spread {String(report.costs.spreadBps)} pb · poślizg{" "}
            {String(report.costs.slippageBps)} pb.
          </p>
        </>
      )}
    </section>
  );
}

export function BacktestPanel({
  portfolioId,
  accountId,
  strategyId,
}: {
  portfolioId: string;
  accountId: string;
  strategyId: string;
}) {
  const load = useCallback(
    (signal: AbortSignal) =>
      backtestsApi.list({ portfolioId, accountId, strategyId }, signal),
    [portfolioId, accountId, strategyId],
  );
  const { state, refresh } = useInvestmentResource(load);
  const [detail, setDetail] = useState<BacktestDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function open(operation: () => Promise<BacktestDetail>) {
    setBusy(true);
    setError("");
    try {
      setDetail(await operation());
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Nie udało się odczytać testu.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (
      await open(() =>
        backtestsApi.submit({ portfolioId, accountId, strategyId }, data),
      )
    ) {
      form.reset();
      refresh();
    }
  }

  return (
    <section className={styles.card} aria-labelledby="backtest-title">
      <h2 id="backtest-title">Testy historyczne</h2>
      <a href="/examples/backtest-snapshot.json" download>
        Pobierz próbkę JSON z danymi testowymi
      </a>
      <form aria-label="Uruchom test historyczny" onSubmit={submit}>
        <label>
          Dane testu JSON
          <input
            name="snapshot"
            type="file"
            accept=".json,application/json"
            required
            disabled={busy}
          />
        </label>
        <div>
          <button type="submit" disabled={busy}>
            Uruchom test
          </button>
        </div>
      </form>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {state.status === "loading" && <p role="status">Wczytywanie prób…</p>}
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
            {state.value.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void open(() =>
                      backtestsApi.get(
                        { portfolioId, accountId, strategyId },
                        row.id,
                      ),
                    )
                  }
                >
                  {phase(row.phase)} · {row.fromOn} – {row.toOn} ·{" "}
                  {row.status === "COMPLETE" ? "Raport" : "Błąd"}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p>Brak prób historycznych.</p>
        ))}
      {detail && <Report result={detail} />}
    </section>
  );
}
