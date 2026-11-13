"use client";

import { useEffect, useState, type ReactNode } from "react";
import { analyticsApi } from "@/lib/analytics-api";
import { ApiError, isAbortError } from "@/lib/api-client";
import {
  analyticsDateLabel,
  analyticsMonth,
  analyticsQuery,
} from "@/lib/analytics-period";
import type {
  AnalyticsGranularity,
  AnalyticsQuery,
} from "@/lib/analytics-types";
import { formatPLN } from "@/lib/money";
import { useSession } from "./session-provider";
import { AnalyticsFilters } from "./analytics-filters";
import { CategoryChart, TrendChart } from "./analytics-charts";
import styles from "./analytics-panel.module.css";

type Resource<T> =
  | { key: string; status: "ready"; data: T }
  | { key: string; status: "error"; message: string };
function useAnalyticsResource<T>(
  load: (query: AnalyticsQuery, signal: AbortSignal) => Promise<T>,
  query: AnalyticsQuery,
  generation: number,
) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<Resource<T> | null>(null);
  const key = `${query.from}/${query.to}/${query.granularity}/${generation}/${revision}`;
  useEffect(() => {
    const controller = new AbortController();
    void load(query, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted)
          setState({ key, status: "ready", data });
      },
      (failure: unknown) => {
        if (
          controller.signal.aborted ||
          isAbortError(failure) ||
          (failure instanceof ApiError && failure.status === 401)
        )
          return;
        setState({
          key,
          status: "error",
          message:
            failure instanceof ApiError ? failure.message : "Spróbuj ponownie.",
        });
      },
    );
    return () => controller.abort();
  }, [key, load, query]);
  return {
    state: state?.key === key ? state : null,
    retry: () => setRevision((value) => value + 1),
  };
}

function Report<T>({
  resource,
  loading,
  retryLabel,
  children,
}: {
  resource: ReturnType<typeof useAnalyticsResource<T>>;
  loading: string;
  retryLabel: string;
  children(data: T): ReactNode;
}) {
  if (!resource.state) return <p role="status">{loading}</p>;
  if (resource.state.status === "error")
    return (
      <div>
        <p className={styles.error} role="alert">
          Nie udało się pobrać tej sekcji. {resource.state.message}
        </p>
        <button type="button" onClick={resource.retry}>
          {retryLabel}
        </button>
      </div>
    );
  return children(resource.state.data);
}

export function AnalyticsPanel() {
  const { state } = useSession();
  if (state.status !== "authenticated") return null;
  return <AnalyticsContent key={state.user.id} />;
}

function AnalyticsContent() {
  const [selection, setSelection] = useState(() => ({
    query: initialQuery(),
    generation: 0,
  }));
  const { query, generation } = selection;
  const summary = useAnalyticsResource(analyticsApi.summary, query, generation);
  const categories = useAnalyticsResource(
    analyticsApi.categories,
    query,
    generation,
  );
  const trends = useAnalyticsResource(analyticsApi.trends, query, generation);
  const range = `${analyticsDateLabel(query.from)} – ${analyticsDateLabel(query.to)}`;
  return (
    <section aria-labelledby="analytics-heading" className={styles.panel}>
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>Twój portfel w liczbach</p>
          <h1 id="analytics-heading">Analityka</h1>
          <p>Sprawdź przychody, wydatki i zmiany w czasie.</p>
        </div>
        <span className={styles.currency}>PLN</span>
      </div>
      <AnalyticsFilters
        initial={query}
        onApply={(next) => {
          window.history.replaceState(
            window.history.state,
            "",
            `${window.location.pathname}?${new URLSearchParams({ ...next })}`,
          );
          setSelection((previous) => ({
            query: next,
            generation: previous.generation + 1,
          }));
        }}
      />
      <p className={styles.range} role="status" aria-atomic="true">
        Okres: <strong>{range}</strong>
      </p>
      <section
        className={styles.report}
        aria-labelledby="analytics-summary-heading"
      >
        <h2 id="analytics-summary-heading">Podsumowanie okresu</h2>
        <p className={styles.hint}>
          Wynik okresu to przychody minus wydatki. Saldo początkowe nie jest
          wliczane.
        </p>
        <Report
          resource={summary}
          loading="Pobieranie podsumowania…"
          retryLabel="Ponów podsumowanie"
        >
          {(data) => (
            <>
              <dl className={styles.cards}>
                <div>
                  <dt>Przychody</dt>
                  <dd className={styles.income}>{formatPLN(data.income)}</dd>
                </div>
                <div>
                  <dt>Wydatki</dt>
                  <dd className={styles.expense}>{formatPLN(data.expenses)}</dd>
                </div>
                <div className={styles.resultCard}>
                  <dt>Wynik okresu</dt>
                  <dd>{formatPLN(data.periodResult)}</dd>
                </div>
              </dl>
              {data.income === "0.00" && data.expenses === "0.00" && (
                <p className={styles.empty}>
                  Brak transakcji w wybranym okresie.
                </p>
              )}
            </>
          )}
        </Report>
      </section>
      <section
        className={styles.report}
        aria-labelledby="analytics-categories-heading"
      >
        <h2 id="analytics-categories-heading">Wydatki według kategorii</h2>
        <Report
          resource={categories}
          loading="Pobieranie kategorii wydatków…"
          retryLabel="Ponów kategorie"
        >
          {(data) =>
            data.items.length === 0 ? (
              <p className={styles.empty}>Brak wydatków w wybranym okresie.</p>
            ) : (
              <>
                <p>
                  Łącznie: <strong>{formatPLN(data.totalExpenses)}</strong>
                </p>
                <CategoryChart items={data.items} />
                <details className={styles.details}>
                  <summary>Pokaż dane kategorii</summary>
                  <div
                    className={styles.tableScroll}
                    tabIndex={0}
                    role="region"
                    aria-label="Tabela kategorii"
                  >
                    <table>
                      <caption>Wydatki według kategorii — {range}</caption>
                      <thead>
                        <tr>
                          <th scope="col">Kategoria</th>
                          <th scope="col">Kwota (PLN)</th>
                          <th scope="col">Udział</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.items.map((item) => (
                          <tr key={item.categoryId}>
                            <th scope="row">{item.categoryName}</th>
                            <td>{formatPLN(item.amount)}</td>
                            <td>{item.percentage.replace(".", ",")}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className={styles.hint}>
                    Udziały są zaokrąglone, dlatego ich suma może różnić się od
                    100%.
                  </p>
                </details>
              </>
            )
          }
        </Report>
      </section>
      <section
        className={styles.report}
        aria-labelledby="analytics-trends-heading"
      >
        <h2 id="analytics-trends-heading">Przychody i wydatki w czasie</h2>
        <p className={styles.hint}>
          {query.granularity === "day"
            ? "Podział dzienny"
            : "Podział miesięczny"}{" "}
          · Okresy bez operacji mają wartość zero.
        </p>
        <Report
          resource={trends}
          loading="Pobieranie trendu…"
          retryLabel="Ponów trend"
        >
          {(data) => (
            <>
              <TrendChart items={data.items} />
              <details className={styles.details}>
                <summary>Pokaż dane trendu</summary>
                <div
                  className={styles.tableScroll}
                  tabIndex={0}
                  role="region"
                  aria-label="Tabela trendu"
                >
                  <table>
                    <caption>Przychody i wydatki w czasie — {range}</caption>
                    <thead>
                      <tr>
                        <th scope="col">Okres</th>
                        <th scope="col">Przychody (PLN)</th>
                        <th scope="col">Wydatki (PLN)</th>
                        <th scope="col">Wynik (PLN)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((point) => (
                        <tr key={point.period}>
                          <th scope="row">
                            {analyticsDateLabel(point.period)}
                          </th>
                          <td>{formatPLN(point.income)}</td>
                          <td>{formatPLN(point.expenses)}</td>
                          <td>{formatPLN(point.periodResult)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </Report>
      </section>
    </section>
  );
}

function initialQuery(): AnalyticsQuery {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    if (params.has("from") || params.has("to")) {
      try {
        return analyticsQuery(
          params.get("from") ?? "",
          params.get("to") ?? "",
          (params.get("granularity") ?? "day") as AnalyticsGranularity,
        );
      } catch {
        /* An invalid bookmarked range falls back to the current month. */
      }
    }
  }
  return { ...analyticsMonth(), granularity: "day" };
}
