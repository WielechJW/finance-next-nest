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

function FieldError({
  name,
  message,
  prefix,
}: {
  name: Field;
  message?: string;
  prefix: string;
}) {
  return message ? (
    <p id={`${prefix}-${name}-error`} className={styles.error}>
      {message}
    </p>
  ) : null;
}

type FormProps =
  | { mode?: "create"; onCreated: (transaction: TransactionDto) => void }
  | {
      mode: "edit";
      transaction: TransactionDto;
      onSaved: (transaction: TransactionDto) => void;
      onCancel: () => void;
      onUnavailable: () => void;
      onPendingChange: (pending: boolean) => void;
    };

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

function TransactionFormContent(
  props: FormProps & { resource: TransactionCategories },
) {
  const { resource } = props;
  const editing = props.mode === "edit";
  const prefix = editing ? "edit-transaction" : "transaction";
  const heading = editing ? "Edycja transakcji" : "Nowa transakcja";
  const { state: categories, retry: retryCategories } = resource;
  const [values, setValues] = useState<Draft>(() =>
    editing
      ? {
          type: props.transaction.type,
          amount: props.transaction.amount,
          categoryId: props.transaction.categoryId,
          title: props.transaction.title,
          occurredOn: props.transaction.occurredOn,
          note: props.transaction.note ?? "",
        }
      : {
          type: "EXPENSE",
          amount: "",
          categoryId: "",
          title: "",
          occurredOn: warsawToday(),
          note: "",
        },
  );
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
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
    if (!unavailable) setFormError("");
    setNotice("");
  }

  function accessible(field: Field, hint?: string) {
    return {
      "aria-invalid": Boolean(errors[field]),
      "aria-describedby":
        [hint, errors[field] ? `${prefix}-${field}-error` : undefined]
          .filter(Boolean)
          .join(" ") || undefined,
    };
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      pending.current ||
      unavailable ||
      categories.status !== "ready" ||
      !available.length
    )
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
    if (editing) props.onPendingChange(true);
    setSaving(true);
    const controller = new AbortController();
    saveController.current = controller;
    let created: TransactionDto | undefined;
    try {
      const input = {
        type: values.type,
        amount,
        categoryId: values.categoryId,
        title,
        occurredOn: values.occurredOn,
      };
      created = editing
        ? await transactionsApi.update(
            props.transaction.id,
            { ...input, note: values.note || null },
            controller.signal,
          )
        : await transactionsApi.create(
            { ...input, ...(values.note ? { note: values.note } : {}) },
            controller.signal,
          );
      if (controller.signal.aborted) return;
      if (!editing) {
        setValues((previous) => ({
          ...previous,
          amount: "",
          title: "",
          note: "",
        }));
        setNotice(
          created.type === "INCOME"
            ? "Przychód zapisany."
            : "Wydatek zapisany.",
        );
      }
    } catch (error) {
      if (
        controller.signal.aborted ||
        isAbortError(error) ||
        (error instanceof ApiError && error.status === 401)
      )
        return;
      if (editing && error instanceof ApiError && error.status === 404) {
        setUnavailable(true);
        setFormError(
          "Ta transakcja nie jest już dostępna. Odświeżamy historię. Możesz zamknąć edycję.",
        );
        props.onUnavailable();
      } else
        setFormError(
          error instanceof ApiError
            ? error.message
            : "Nie udało się zapisać operacji. Spróbuj ponownie.",
        );
    } finally {
      pending.current = false;
      if (!controller.signal.aborted) {
        setSaving(false);
        if (editing) props.onPendingChange(false);
      }
    }
    // Refreshing reads is separate from the confirmed mutation.
    if (created && !controller.signal.aborted) {
      if (editing) props.onSaved(created);
      else props.onCreated(created);
    }
  }

  return (
    <section
      className={styles.formSection}
      aria-labelledby={`${prefix}-form-heading`}
    >
      <h2 id={`${prefix}-form-heading`} tabIndex={-1}>
        {heading}
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
        aria-labelledby={`${prefix}-form-heading`}
      >
        <div className={styles.fields}>
          <div className={styles.field}>
            <label htmlFor={`${prefix}-type`}>Typ operacji</label>
            <select
              id={`${prefix}-type`}
              name="type"
              value={values.type}
              onChange={(event) => change("type", event.target.value)}
              disabled={saving}
              {...accessible("type")}
            >
              <option value="EXPENSE">Wydatek</option>
              <option value="INCOME">Przychód</option>
            </select>
            <FieldError prefix={prefix} name="type" message={errors.type} />
          </div>
          <div className={styles.field}>
            <label htmlFor={`${prefix}-amount`}>Kwota</label>
            <input
              id={`${prefix}-amount`}
              name="amount"
              type="text"
              inputMode="decimal"
              required
              value={values.amount}
              onChange={(event) => change("amount", event.target.value)}
              disabled={saving}
              {...accessible("amount", `${prefix}-amount-hint`)}
            />
            <p id={`${prefix}-amount-hint`} className={styles.hint}>
              Dodatnia kwota w PLN. Możesz użyć przecinka, np. 12,50.
            </p>
            <FieldError prefix={prefix} name="amount" message={errors.amount} />
          </div>
          <div className={styles.field}>
            <label htmlFor={`${prefix}-categoryId`}>Kategoria</label>
            <select
              id={`${prefix}-categoryId`}
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
            <FieldError
              prefix={prefix}
              name="categoryId"
              message={errors.categoryId}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor={`${prefix}-title`}>Tytuł</label>
            <input
              id={`${prefix}-title`}
              name="title"
              type="text"
              required
              value={values.title}
              onChange={(event) => change("title", event.target.value)}
              disabled={saving}
              {...accessible("title")}
            />
            <FieldError prefix={prefix} name="title" message={errors.title} />
          </div>
          <div className={styles.field}>
            <label htmlFor={`${prefix}-occurredOn`}>Data operacji</label>
            <input
              id={`${prefix}-occurredOn`}
              name="occurredOn"
              type="date"
              min="0001-01-01"
              max="9999-12-31"
              required
              value={values.occurredOn}
              onChange={(event) => change("occurredOn", event.target.value)}
              disabled={saving}
              {...accessible("occurredOn", `${prefix}-date-hint`)}
            />
            <p id={`${prefix}-date-hint`} className={styles.hint}>
              {!editing && "Domyślnie dziś w Polsce. "}
              Przyszłe daty są dozwolone i wpływają na saldo.
            </p>
            <FieldError
              prefix={prefix}
              name="occurredOn"
              message={errors.occurredOn}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor={`${prefix}-note`}>Notatka (opcjonalnie)</label>
            <textarea
              id={`${prefix}-note`}
              name="note"
              rows={3}
              value={values.note}
              onChange={(event) => change("note", event.target.value)}
              disabled={saving}
              {...accessible("note", `${prefix}-note-hint`)}
            />
            <p id={`${prefix}-note-hint`} className={styles.hint}>
              Do 1000 znaków.
            </p>
            <FieldError prefix={prefix} name="note" message={errors.note} />
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
              saving ||
              unavailable ||
              categories.status !== "ready" ||
              !available.length
            }
          >
            {saving
              ? "Zapisywanie…"
              : editing
                ? "Zapisz zmiany"
                : "Zapisz transakcję"}
          </button>
          {editing && (
            <button
              type="button"
              disabled={saving}
              onClick={props.onCancel}
              className={styles.secondary}
            >
              Anuluj
            </button>
          )}
          <p role="status" aria-atomic="true" className={styles.success}>
            {notice}
          </p>
        </div>
      </form>
    </section>
  );
}
