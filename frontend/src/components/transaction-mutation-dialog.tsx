"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, isAbortError } from "@/lib/api-client";
import { formatPLN } from "@/lib/money";
import { transactionsApi } from "@/lib/transactions-api";
import type { TransactionDto } from "@/lib/transaction-types";
import { TransactionForm } from "./transaction-form";
import type { TransactionCategories } from "./use-transaction-categories";
import styles from "./transaction-mutation-dialog.module.css";

export interface TransactionSelection {
  kind: "edit" | "delete";
  transaction: TransactionDto;
  trigger: HTMLButtonElement;
}

export function TransactionMutationDialog({
  selection,
  categories,
  onCancel,
  onChanged,
  onUnavailable,
}: {
  selection: TransactionSelection;
  categories: TransactionCategories;
  onCancel: () => void;
  onChanged: () => void;
  onUnavailable: () => void;
}) {
  const { kind, transaction, trigger } = selection;
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const completed = useRef(false);
  const request = useRef<AbortController | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    // A deletion starts on the safe action; editing starts on its first field.
    element
      .querySelector<HTMLElement>(kind === "delete" ? "button" : "select")
      ?.focus();
    return () => {
      request.current?.abort();
      element.close();
      if (!completed.current && trigger.isConnected) trigger.focus();
      else document.getElementById("history-heading")?.focus();
    };
  }, [kind, trigger]);

  function changed() {
    completed.current = true;
    onChanged();
  }

  async function remove() {
    if (pending.current || unavailable) return;
    pending.current = true;
    setDeleting(true);
    setError("");
    const controller = new AbortController();
    request.current = controller;
    let removed = false;
    try {
      await transactionsApi.remove(transaction.id, controller.signal);
      removed = !controller.signal.aborted;
    } catch (cause) {
      if (
        controller.signal.aborted ||
        isAbortError(cause) ||
        (cause instanceof ApiError && cause.status === 401)
      )
        return;
      if (cause instanceof ApiError && cause.status === 404) {
        setUnavailable(true);
        setError("Ta transakcja nie jest już dostępna. Odświeżamy historię.");
        onUnavailable();
      } else {
        setError(
          cause instanceof ApiError
            ? cause.message
            : "Nie udało się usunąć transakcji. Spróbuj ponownie.",
        );
      }
    } finally {
      pending.current = false;
      if (!controller.signal.aborted) setDeleting(false);
    }
    if (removed) changed();
  }

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={
        kind === "edit"
          ? "edit-transaction-form-heading"
          : "delete-transaction-heading"
      }
      aria-describedby={
        kind === "delete" ? "delete-transaction-description" : undefined
      }
      onCancel={(event) => {
        event.preventDefault();
        if (!pending.current) onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = event.currentTarget.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)",
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first) event.preventDefault();
        else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      {kind === "edit" ? (
        <TransactionForm
          mode="edit"
          transaction={transaction}
          categories={categories}
          onSaved={changed}
          onCancel={onCancel}
          onUnavailable={onUnavailable}
          onPendingChange={(value) => {
            pending.current = value;
          }}
        />
      ) : (
        <>
          <h2 id="delete-transaction-heading">Usunąć transakcję?</h2>
          <p id="delete-transaction-description">
            Operacja „{transaction.title}”, kwota{" "}
            <strong>
              {transaction.type === "INCOME"
                ? "+" + formatPLN(transaction.amount)
                : formatPLN("-" + transaction.amount)}
            </strong>
            . Usunięcie zmieni saldo portfela.
          </p>
          <p role="alert" className={styles.error}>
            {error}
          </p>
          <div className={styles.actions} aria-busy={deleting}>
            <button
              type="button"
              onClick={onCancel}
              disabled={deleting}
              className={styles.secondary}
            >
              Anuluj
            </button>
            <button
              type="button"
              onClick={() => void remove()}
              disabled={deleting || unavailable}
              className={styles.danger}
            >
              {deleting ? "Usuwanie…" : "Usuń transakcję"}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
