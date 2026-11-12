"use client";

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type SubmitEvent,
} from "react";
import { ApiError, isAbortError } from "@/lib/api-client";
import { formatPLN } from "@/lib/money";
import { isCalendarDate } from "@/lib/transaction-input";
import { transactionsApi } from "@/lib/transactions-api";
import type {
  TransactionFilters,
  TransactionListDto,
  TransactionType,
} from "@/lib/transaction-types";
import type { TransactionCategories } from "./use-transaction-categories";
import styles from "./transaction-history.module.css";

export interface TransactionHistoryQuery {
  filters: TransactionFilters;
  page: number;
  revision: number;
}
type Draft = {
  type: TransactionType | "";
  categoryId: string;
  from: string;
  to: string;
};
type Errors = Partial<Record<keyof Draft, string>>;
type HistoryState = { query: TransactionHistoryQuery } & (
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: TransactionListDto }
);
const emptyFilters: Draft = { type: "", categoryId: "", from: "", to: "" };

export function TransactionHistory({
  categories,
  query,
  setQuery,
}: {
  categories: TransactionCategories;
  query: TransactionHistoryQuery;
  setQuery: Dispatch<SetStateAction<TransactionHistoryQuery>>;
}) {
  const [draft, setDraft] = useState<Draft>(() => ({
    ...emptyFilters,
    ...query.filters,
  }));
  const [errors, setErrors] = useState<Errors>({});
  const [state, setState] = useState<HistoryState>({
    status: "loading",
    query,
  });
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void transactionsApi
      .list(
        { ...query.filters, page: query.page, pageSize: 20 },
        controller.signal,
      )
      .then(
        (data) => {
          if (controller.signal.aborted) return;
          const lastPage = Math.max(1, Math.ceil(data.total / data.pageSize));
          if (data.page > lastPage) {
            setQuery((current) =>
              current === query ? { ...current, page: lastPage } : current,
            );
            return;
          }
          setState({ status: "ready", data, query });
        },
        (error: unknown) => {
          if (
            controller.signal.aborted ||
            isAbortError(error) ||
            (error instanceof ApiError && error.status === 401)
          )
            return;
          setState({
            status: "error",
            message:
              error instanceof ApiError
                ? error.message
                : "Nie udało się pobrać historii transakcji.",
            query,
          });
        },
      );
    return () => controller.abort();
  }, [query, setQuery]);

  // A result belongs to its exact request, including retries and POST refreshes.
  const current =
    state.query === query ? state : { status: "loading" as const };
  const available =
    categories.state.status === "ready"
      ? categories.state.items.filter(
          (item) => !draft.type || item.type === draft.type,
        )
      : [];
  const filtered = Object.keys(query.filters).length > 0;

  function change(field: keyof Draft, value: string) {
    const compatible =
      field !== "type" ||
      !value ||
      available.some(
        (item) => item.id === draft.categoryId && item.type === value,
      );
    setDraft((previous) => ({
      ...previous,
      [field]: value,
      ...(!compatible ? { categoryId: "" } : {}),
    }));
    setErrors((previous) => ({
      ...previous,
      [field]: undefined,
      ...(!compatible ? { categoryId: undefined } : {}),
    }));
  }

  function apply(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: Errors = {};
    const fromInput = event.currentTarget.elements.namedItem(
      "from",
    ) as HTMLInputElement;
    const toInput = event.currentTarget.elements.namedItem(
      "to",
    ) as HTMLInputElement;
    if (
      fromInput.validity.badInput ||
      (draft.from && !isCalendarDate(draft.from))
    )
      next.from = "Podaj istniejącą datę od 0001-01-01 do 9999-12-31.";
    if (toInput.validity.badInput || (draft.to && !isCalendarDate(draft.to)))
      next.to = "Podaj istniejącą datę od 0001-01-01 do 9999-12-31.";
    if (
      !next.from &&
      !next.to &&
      draft.from &&
      draft.to &&
      draft.from > draft.to
    )
      next.to = "Data do nie może być wcześniejsza niż data od.";
    if (
      draft.categoryId &&
      !available.some((item) => item.id === draft.categoryId)
    )
      next.categoryId = "Wybierz kategorię pasującą do filtra typu.";
    setErrors(next);
    const first = (Object.keys(next) as (keyof Draft)[])[0];
    if (first) {
      const control = event.currentTarget.elements.namedItem(first);
      if (control instanceof HTMLElement) control.focus();
      return;
    }
    const filters: TransactionFilters = {
      ...(draft.type ? { type: draft.type } : {}),
      ...(draft.categoryId ? { categoryId: draft.categoryId } : {}),
      ...(draft.from ? { from: draft.from } : {}),
      ...(draft.to ? { to: draft.to } : {}),
    };
    setQuery((previous) => ({
      filters,
      page: 1,
      revision: previous.revision + 1,
    }));
  }

  function reset() {
    setDraft(emptyFilters);
    setErrors({});
    setQuery((previous) => ({
      filters: {},
      page: 1,
      revision: previous.revision + 1,
    }));
  }

  function accessibility(field: keyof Draft) {
    return {
      "aria-invalid": Boolean(errors[field]),
      "aria-describedby": errors[field] ? `history-${field}-error` : undefined,
    };
  }

  function page(value: number) {
    setQuery((previous) => ({ ...previous, page: value }));
    heading.current?.focus();
  }

  return (
    <section className={styles.history} aria-labelledby="history-heading">
      <h2 id="history-heading" tabIndex={-1} ref={heading}>
        Historia transakcji
      </h2>
      <p>
        Filtry dotyczą listy operacji. Saldo portfela obejmuje całą historię.
      </p>
      <form onSubmit={apply} noValidate aria-label="Filtry historii">
        <div className={styles.filters}>
          <div className={styles.field}>
            <label htmlFor="history-type">Filtr typu</label>
            <select
              id="history-type"
              name="type"
              value={draft.type}
              onChange={(event) => change("type", event.target.value)}
            >
              <option value="">Wszystkie typy</option>
              <option value="EXPENSE">Wydatki</option>
              <option value="INCOME">Przychody</option>
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="history-categoryId">Filtr kategorii</label>
            <select
              id="history-categoryId"
              name="categoryId"
              value={draft.categoryId}
              onChange={(event) => change("categoryId", event.target.value)}
              disabled={categories.state.status !== "ready"}
              {...accessibility("categoryId")}
            >
              <option value="">Wszystkie kategorie</option>
              {available.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="history-from">Data od</label>
            <input
              id="history-from"
              name="from"
              type="date"
              min="0001-01-01"
              max="9999-12-31"
              value={draft.from}
              onChange={(event) => change("from", event.target.value)}
              {...accessibility("from")}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="history-to">Data do</label>
            <input
              id="history-to"
              name="to"
              type="date"
              min="0001-01-01"
              max="9999-12-31"
              value={draft.to}
              onChange={(event) => change("to", event.target.value)}
              {...accessibility("to")}
            />
          </div>
        </div>
        <div role="alert">
          {(Object.keys(errors) as (keyof Draft)[]).map(
            (field) =>
              errors[field] && (
                <p
                  key={field}
                  id={`history-${field}-error`}
                  className={styles.error}
                >
                  {errors[field]}
                </p>
              ),
          )}
        </div>
        <div className={styles.actions}>
          <button type="submit">Filtruj</button>
          <button type="button" onClick={reset} className={styles.secondary}>
            Wyczyść filtry
          </button>
        </div>
      </form>

      {categories.state.status === "error" ? (
        <div>
          <p role="alert">
            Nie udało się pobrać kategorii historii. {categories.state.message}
          </p>
          <button type="button" onClick={categories.retry}>
            Ponów kategorie historii
          </button>
        </div>
      ) : current.status === "error" ? (
        <div>
          <p role="alert">Nie udało się pobrać historii. {current.message}</p>
          <button
            type="button"
            onClick={() =>
              setQuery((previous) => ({
                ...previous,
                revision: previous.revision + 1,
              }))
            }
          >
            Ponów pobieranie historii
          </button>
        </div>
      ) : current.status !== "ready" || categories.state.status !== "ready" ? (
        <p role="status">Ładowanie historii…</p>
      ) : (
        <>
          <p role="status" aria-atomic="true">
            Liczba wyników: {current.data.total}. Strona {current.data.page} z{" "}
            {Math.max(1, Math.ceil(current.data.total / current.data.pageSize))}
            .
          </p>
          {current.data.items.length === 0 ? (
            <div className={styles.empty}>
              <p>
                {filtered
                  ? "Brak transakcji spełniających wybrane filtry."
                  : "Nie masz jeszcze transakcji. Dodaj pierwszy przychód lub wydatek."}
              </p>
              {filtered ? (
                <button type="button" onClick={reset}>
                  Pokaż całą historię
                </button>
              ) : (
                <a href="#transaction-form-heading">
                  Dodaj pierwszą transakcję
                </a>
              )}
            </div>
          ) : (
            <ul className={styles.list} aria-label="Lista transakcji">
              {current.data.items.map((item) => {
                const category =
                  categories.state.status === "ready"
                    ? categories.state.items.find(
                        (entry) => entry.id === item.categoryId,
                      )?.name
                    : undefined;
                const [year, month, day] = item.occurredOn.split("-");
                const income = item.type === "INCOME";
                return (
                  <li key={item.id}>
                    <h3>{item.title}</h3>
                    <dl>
                      <div>
                        <dt>Data</dt>
                        <dd>
                          <time dateTime={item.occurredOn}>
                            {day}.{month}.{year}
                          </time>
                        </dd>
                      </div>
                      <div>
                        <dt>Kategoria</dt>
                        <dd>{category ?? "Nieznana kategoria"}</dd>
                      </div>
                      <div>
                        <dt>Typ</dt>
                        <dd>{income ? "Przychód" : "Wydatek"}</dd>
                      </div>
                      <div>
                        <dt>Kwota</dt>
                        <dd className={income ? styles.income : styles.expense}>
                          {income
                            ? "+" + formatPLN(item.amount)
                            : formatPLN("-" + item.amount)}
                        </dd>
                      </div>
                    </dl>
                  </li>
                );
              })}
            </ul>
          )}
          <nav aria-label="Strony historii" className={styles.pagination}>
            <button
              type="button"
              onClick={() => page(query.page - 1)}
              disabled={query.page <= 1}
            >
              Poprzednia strona
            </button>
            <button
              type="button"
              onClick={() => page(query.page + 1)}
              disabled={
                query.page * current.data.pageSize >= current.data.total
              }
            >
              Następna strona
            </button>
          </nav>
        </>
      )}
    </section>
  );
}
