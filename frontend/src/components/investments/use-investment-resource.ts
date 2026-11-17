"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, isAbortError } from "@/lib/api-client";

export function useInvestmentResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready"; value: T }
    | { status: "error"; message: string }
  >({ status: "loading" });
  const [revision, setRevision] = useState(0);
  const current = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    current.current = controller;
    void load(controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setState({ status: "ready", value });
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
            error instanceof Error
              ? error.message
              : "Nie udało się pobrać inwestycji.",
        });
      },
    );
    return () => controller.abort();
  }, [load, revision]);
  function refresh() {
    current.current?.abort();
    setState({ status: "loading" });
    setRevision((value) => value + 1);
  }
  return { state, refresh };
}
