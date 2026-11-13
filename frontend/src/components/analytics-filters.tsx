"use client";

import { useState, type FormEvent } from "react";
import { analyticsMonth, analyticsQuery } from "@/lib/analytics-period";
import type {
  AnalyticsGranularity,
  AnalyticsQuery,
} from "@/lib/analytics-types";
import styles from "./analytics-panel.module.css";

export function AnalyticsFilters({
  initial,
  onApply,
}: {
  initial: AnalyticsQuery;
  onApply(query: AnalyticsQuery): void;
}) {
  const [preset, setPreset] = useState(() => {
    const current = analyticsMonth(),
      previous = analyticsMonth(true);
    return initial.from === current.from && initial.to === current.to
      ? "current"
      : initial.from === previous.from && initial.to === previous.to
        ? "previous"
        : "custom";
  });
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [granularity, setGranularity] = useState<AnalyticsGranularity>(
    initial.granularity,
  );
  const [error, setError] = useState("");

  function apply(nextFrom = from, nextTo = to) {
    try {
      const query = analyticsQuery(nextFrom, nextTo, granularity);
      setError("");
      onApply(query);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Sprawdź zakres dat.",
      );
    }
  }
  function choose(previous: boolean) {
    const range = analyticsMonth(previous);
    setPreset(previous ? "previous" : "current");
    setFrom(range.from);
    setTo(range.to);
    apply(range.from, range.to);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    apply();
  }

  return (
    <form
      className={styles.filters}
      aria-label="Filtry analityki"
      onSubmit={submit}
      noValidate
    >
      <div className={styles.presets} role="group" aria-label="Wybór okresu">
        <button
          type="button"
          aria-pressed={preset === "current"}
          onClick={() => choose(false)}
        >
          Bieżący miesiąc
        </button>
        <button
          type="button"
          aria-pressed={preset === "previous"}
          onClick={() => choose(true)}
        >
          Poprzedni miesiąc
        </button>
        <button
          type="button"
          aria-pressed={preset === "custom"}
          onClick={() => {
            setPreset("custom");
            setError("");
          }}
        >
          Własny zakres
        </button>
      </div>
      <div className={styles.fields}>
        {preset === "custom" && (
          <>
            <div className={styles.field}>
              <label htmlFor="analytics-from">Data od</label>
              <input
                id="analytics-from"
                type="date"
                min="0001-01-01"
                max="9999-12-31"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                aria-invalid={!!error}
                aria-describedby={error ? "analytics-filter-error" : undefined}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="analytics-to">Data do</label>
              <input
                id="analytics-to"
                type="date"
                min="0001-01-01"
                max="9999-12-31"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                aria-invalid={!!error}
                aria-describedby={error ? "analytics-filter-error" : undefined}
              />
            </div>
          </>
        )}
        <div className={styles.field}>
          <label htmlFor="analytics-granularity">Podział trendu</label>
          <select
            id="analytics-granularity"
            value={granularity}
            onChange={(event) =>
              setGranularity(event.target.value as AnalyticsGranularity)
            }
            aria-describedby="analytics-filter-hint"
          >
            <option value="day">Dziennie</option>
            <option value="month">Miesięcznie</option>
          </select>
        </div>
        <button className={styles.apply} type="submit">
          Zastosuj
        </button>
      </div>
      <p id="analytics-filter-hint" className={styles.hint}>
        Własny zakres i podział trendu zatwierdź przyciskiem Zastosuj.
        Maksymalnie 366 dni lub 120 miesięcy.
      </p>
      {error && (
        <p id="analytics-filter-error" className={styles.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
