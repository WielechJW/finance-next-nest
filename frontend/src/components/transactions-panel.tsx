"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, isAbortError } from "@/lib/api-client";
import { formatPLN } from "@/lib/money";
import { walletApi } from "@/lib/wallet-api";
import type { WalletDto } from "@/lib/wallet-types";
import { useSession } from "./session-provider";
import { TransactionForm } from "./transaction-form";
import {
  TransactionHistory,
  type TransactionHistoryQuery,
} from "./transaction-history";
import { useTransactionCategories } from "./use-transaction-categories";
import styles from "./transaction-form.module.css";

type WalletState =
  | { status: "loading" }
  | { status: "ready"; wallet: WalletDto }
  | { status: "error"; message: string };

export function TransactionsPanel() {
  const { state } = useSession();
  if (state.status !== "authenticated") return null;
  return <TransactionsContent key={state.user.id} />;
}

function TransactionsContent() {
  const categories = useTransactionCategories();
  const [historyQuery, setHistoryQuery] = useState<TransactionHistoryQuery>({
    filters: {},
    page: 1,
    revision: 0,
  });
  const [wallet, setWallet] = useState<WalletState>({ status: "loading" });
  const [revision, setRevision] = useState(0);
  const walletRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    walletRequest.current = controller;
    void walletApi.get(controller.signal).then(
      (value) => {
        if (!controller.signal.aborted)
          setWallet({ status: "ready", wallet: value });
      },
      (error: unknown) => {
        if (
          controller.signal.aborted ||
          isAbortError(error) ||
          (error instanceof ApiError && error.status === 401)
        )
          return;
        setWallet({
          status: "error",
          message:
            error instanceof ApiError ? error.message : "Spróbuj ponownie.",
        });
      },
    );
    return () => controller.abort();
  }, [revision]);

  function refreshWallet() {
    walletRequest.current?.abort();
    setWallet({ status: "loading" });
    setRevision((value) => value + 1);
  }

  function created() {
    refreshWallet();
    setHistoryQuery((previous) => ({
      ...previous,
      page: 1,
      revision: previous.revision + 1,
    }));
  }

  return (
    <section aria-labelledby="transactions-heading" className={styles.panel}>
      <h1 id="transactions-heading">Transakcje</h1>
      <p>Dodaj przychód lub wydatek do swojego portfela.</p>
      <section aria-label="Saldo portfela" className={styles.balance}>
        {wallet.status === "loading" && <p role="status">Odświeżanie salda…</p>}
        {wallet.status === "ready" && (
          <>
            <dl>
              <dt>Bieżące saldo</dt>
              <dd>{formatPLN(wallet.wallet.balance)}</dd>
            </dl>
            <p>
              Saldo obejmuje całą historię, także zapisane przyszłe operacje.
            </p>
          </>
        )}
        {wallet.status === "error" && (
          <>
            <p role="alert">Nie udało się odświeżyć salda. {wallet.message}</p>
            <button type="button" onClick={refreshWallet}>
              Odśwież saldo
            </button>
          </>
        )}
      </section>
      <TransactionForm onCreated={created} categories={categories} />
      <TransactionHistory
        categories={categories}
        query={historyQuery}
        setQuery={setHistoryQuery}
      />
    </section>
  );
}
