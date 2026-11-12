"use client";

import { useEffect, useState } from "react";
import { ApiError, isAbortError } from "@/lib/api-client";
import { transactionsApi } from "@/lib/transactions-api";
import type { CategoryDto } from "@/lib/transaction-types";

export interface TransactionCategories {
  state:
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; items: CategoryDto[] };
  retry: () => void;
}

export function useTransactionCategories(): TransactionCategories {
  const [state, setState] = useState<TransactionCategories["state"]>({
    status: "loading",
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void transactionsApi.getCategories(controller.signal).then(
      (items) => {
        if (!controller.signal.aborted) setState({ status: "ready", items });
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
              : "Nie udało się pobrać kategorii.",
        });
      },
    );
    return () => controller.abort();
  }, [attempt]);
  return {
    state,
    retry: () => {
      setState({ status: "loading" });
      setAttempt((value) => value + 1);
    },
  };
}
