"use client";

import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { ApiError, isAbortError } from "@/lib/api-client";
import {
  isCalendarDate,
  normalizeTransactionAmount,
  warsawToday,
} from "@/lib/transaction-input";
import { isTransactionType, transactionsApi } from "@/lib/transactions-api";
import type { TransactionDto, TransactionType } from "@/lib/transaction-types";
import {
  useTransactionCategories,
  type TransactionCategories,
} from "./use-transaction-categories";
import styles from "./transaction-form.module.css";

type Draft = {
  type: TransactionType;
  amount: string;
  categoryId: string;
  title: string;
  occurredOn: string;
  note: string;
};
type Field = keyof Draft;
type Errors = Partial<Record<Field, string>>;

function FieldError({ name, message }: { name: Field; message?: string }) {
  return message ? (
    <p id={`transaction-${name}-error`} className={styles.error}>
      {message}
    </p>
  ) : null;
}

type FormProps = { onCreated: (transaction: TransactionDto) => void };

export function TransactionForm({
  categories,
  ...props
}: FormProps & { categories?: TransactionCategories }) {
  return categories ? (
    <TransactionFormContent {...props} resource={categories} />
  ) : (
    <StandaloneTransactionForm {...props} />
  );
}

function StandaloneTransactionForm(props: FormProps) {
  const resource = useTransactionCategories();
  return <TransactionFormContent {...props} resource={resource} />;
}

function TransactionFormContent({
  onCreated,
  resource,
}: FormProps & { resource: TransactionCategories }) {
  const { state: categories, retry: retryCategories } = resource;
  const [values, setValues] = useState<Draft>(() => ({
    type: "EXPENSE",
    amount: "",
    categoryId: "",
    title: "",
    occurredOn: warsawToday(),
    note: "",
  }));
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const saveController = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      saveController.current?.abort();
    },
    [],
  );

  const available =
    categories.status === "ready"
      ? categories.items.filter((category) => category.type === values.type)
      : [];

  function change(field: Field, value: string) {
    setValues((previous) => ({
      ...previous,
      [field]: value,
      ...(field === "type" ? { categoryId: "" } : {}),
    }));
    setErrors((previous) => ({
      ...previous,
      [field]: undefined,
      ...(field === "type" ? { categoryId: undefined } : {}),
    }));
    setFormError("");
    setNotice("");
  }

  function accessible(field: Field, hint?: string) {
    return {
      "aria-invalid": Boolean(errors[field]),
      "aria-describedby":
        [hint, errors[field] ? `transaction-${field}-error` : undefined]
          .filter(Boolean)
          .join(" ") || undefined,
    };
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || categories.status !== "ready" || !available.length)
      return;
    const form = event.currentTarget;
    const next: Errors = {};
    if (!isTransactionType(values.type))
      next.type = "Wybierz wydatek albo przychód.";
    let amount = "";
    try {
      amount = normalizeTransactionAmount(values.amount);
    } catch (error) {
      next.amount =
        error instanceof Error ? error.message : "Podaj poprawną kwotę.";
    }
    if (!available.some((category) => category.id === values.categoryId))
      next.categoryId = "Wybierz kategorię pasującą do typu operacji.";
    const title = values.title.trim();
    if (Array.from(title).length < 1 || Array.from(title).length > 100)
      next.title = "Tytuł musi mieć od 1 do 100 znaków.";
    if (!isCalendarDate(values.occurredOn))
      next.occurredOn = "Podaj istniejącą datę od 0001-01-01 do 9999-12-31.";
    if (Array.from(values.note).length > 1000)
      next.note = "Notatka może mieć najwyżej 1000 znaków.";
    setErrors(next);
    setFormError("");
    setNotice("");
    const first = (Object.keys(next) as Field[])[0];
    if (first) {
      const field = form.elements.namedItem(first);
      if (field instanceof HTMLElement) field.focus();
      return;
    }

    pending.current = true;
    setSaving(true);
    const controller = new AbortController();
    saveController.current = controller;
    let created: TransactionDto | undefined;
    try {
      created = await transactionsApi.create(
        {
          type: values.type,
          amount,
          categoryId: values.categoryId,
          title,
          occurredOn: values.occurredOn,
          ...(values.note ? { note: values.note } : {}),
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setValues((previous) => ({
        ...previous,
        amount: "",
        title: "",
        note: "",
      }));
      setNotice(
        created.type === "INCOME" ? "Przychód zapisany." : "Wydatek zapisany.",
      );
    } catch (error) {
      if (
        controller.signal.aborted ||
        isAbortError(error) ||
        (error instanceof ApiError && error.status === 401)
      )
        return;
      setFormError(
        error instanceof ApiError
          ? error.message
          : "Nie udało się zapisać operacji. Spróbuj ponownie.",
      );
    } finally {
      pending.current = false;
      if (!controller.signal.aborted) setSaving(false);
    }
    // Refreshing the wallet/history is separate from the confirmed POST.
    if (created && !controller.signal.aborted) onCreated(created);
  }

  return (
    <section
      className={styles.formSection}
      aria-labelledby="transaction-form-heading"
    >
      <h2 id="transaction-form-heading" tabIndex={-1}>
        Nowa transakcja
      </h2>
      {categories.status === "loading" && (
        <p role="status">Ładowanie kategorii…</p>
      )}
      {categories.status === "error" && (
        <div className={styles.loadError}>
          <p role="alert">
            Nie udało się pobrać kategorii. {categories.message}
          </p>
          <button type="button" onClick={retryCategories}>
            Ponów pobieranie kategorii
          </button>
        </div>
      )}
      {categories.status === "ready" && !available.length && (
        <p role="status">Brak kategorii dla wybranego typu operacji.</p>
      )}
      <form
        onSubmit={submit}
        noValidate
        aria-busy={saving}
        aria-labelledby="transaction-form-heading"
      >
        <div className={styles.fields}>
          <div className={styles.field}>
            <label htmlFor="transaction-type">Typ operacji</label>
            <select
              id="transaction-type"
              name="type"
              value={values.type}
              onChange={(event) => change("type", event.target.value)}
              disabled={saving}
              {...accessible("type")}
            >
              <option value="EXPENSE">Wydatek</option>
              <option value="INCOME">Przychód</option>
            </select>
            <FieldError name="type" message={errors.type} />
          </div>
          <div className={styles.field}>
            <label htmlFor="transaction-amount">Kwota</label>
            <input
              id="transaction-amount"
              name="amount"
              type="text"
              inputMode="decimal"
              required
              value={values.amount}
              onChange={(event) => change("amount", event.target.value)}
              disabled={saving}
              {...accessible("amount", "transaction-amount-hint")}
            />
            <p id="transaction-amount-hint" className={styles.hint}>
              Dodatnia kwota w PLN. Możesz użyć przecinka, np. 12,50.
            </p>
            <FieldError name="amount" message={errors.amount} />
          </div>
          <div className={styles.field}>
            <label htmlFor="transaction-categoryId">Kategoria</label>
            <select
              id="transaction-categoryId"
              name="categoryId"
              required
              value={values.categoryId}
              onChange={(event) => change("categoryId", event.target.value)}
              disabled={
                saving || categories.status !== "ready" || !available.length
              }
              {...accessible("categoryId")}
            >
              <option value="">Wybierz kategorię</option>
              {available.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <FieldError name="categoryId" message={errors.categoryId} />
          </div>
          <div className={styles.field}>
            <label htmlFor="transaction-title">Tytuł</label>
            <input
              id="transaction-title"
              name="title"
              type="text"
              required
              value={values.title}
              onChange={(event) => change("title", event.target.value)}
              disabled={saving}
              {...accessible("title")}
            />
            <FieldError name="title" message={errors.title} />
          </div>
          <div className={styles.field}>
            <label htmlFor="transaction-occurredOn">Data operacji</label>
            <input
              id="transaction-occurredOn"
              name="occurredOn"
              type="date"
              min="0001-01-01"
              max="9999-12-31"
              required
              value={values.occurredOn}
              onChange={(event) => change("occurredOn", event.target.value)}
              disabled={saving}
              {...accessible("occurredOn", "transaction-date-hint")}
            />
            <p id="transaction-date-hint" className={styles.hint}>
              Domyślnie dziś w Polsce. Przyszłe daty są dozwolone i wpływają na
              saldo.
            </p>
            <FieldError name="occurredOn" message={errors.occurredOn} />
          </div>
          <div className={styles.field}>
            <label htmlFor="transaction-note">Notatka (opcjonalnie)</label>
            <textarea
              id="transaction-note"
              name="note"
              rows={3}
              value={values.note}
              onChange={(event) => change("note", event.target.value)}
              disabled={saving}
              {...accessible("note", "transaction-note-hint")}
            />
            <p id="transaction-note-hint" className={styles.hint}>
              Do 1000 znaków.
            </p>
            <FieldError name="note" message={errors.note} />
          </div>
        </div>
        <div role="alert" aria-atomic="true">
          {Object.values(errors).some(Boolean) && (
            <p className={styles.error}>Popraw zaznaczone pola.</p>
          )}
          {formError && <p className={styles.error}>{formError}</p>}
        </div>
        <div className={styles.actions}>
          <button
            type="submit"
            disabled={
              saving || categories.status !== "ready" || !available.length
            }
          >
            {saving ? "Zapisywanie…" : "Zapisz transakcję"}
          </button>
          <p role="status" aria-atomic="true" className={styles.success}>
            {notice}
          </p>
        </div>
      </form>
    </section>
  );
}
