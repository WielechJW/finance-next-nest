"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { transactionsApi } from "@/lib/transactions-api";
import type { TransactionDto } from "@/lib/transaction-types";
import { formatPLN } from "@/lib/money";
import { UiIcon } from "./ui-icon";
import styles from "./wallet-panel.module.css";

type Activity =
  | { status: "loading" | "error" }
  | { status: "ready"; items: TransactionDto[] };

export function WalletActivity() {
  const [activity, setActivity] = useState<Activity>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void transactionsApi.list({ page: 1, pageSize: 4 }, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted)
          setActivity({ status: "ready", items: result.items });
      },
      () => {
        if (!controller.signal.aborted) setActivity({ status: "error" });
      },
    );
    return () => controller.abort();
  }, [attempt]);

  return (
    <section
      className={styles.activity}
      aria-labelledby="wallet-activity-heading"
    >
      <div className={styles.sectionHeading}>
        <span className={styles.sectionIcon}>
          <UiIcon name="clock-counter-clockwise" />
        </span>
        <h2 id="wallet-activity-heading">Ostatnie transakcje</h2>
      </div>
      {activity.status === "loading" && <p>Ładowanie ostatnich operacji…</p>}
      {activity.status === "error" && (
        <p>
          Nie udało się pobrać ostatnich operacji.{" "}
          <button
            type="button"
            onClick={() => {
              setActivity({ status: "loading" });
              setAttempt((value) => value + 1);
            }}
          >
            Ponów odczyt
          </button>
        </p>
      )}
      {activity.status === "ready" &&
        (activity.items.length ? (
          <ul className={styles.entries}>
            {activity.items.map((item) => {
              const income = item.type === "INCOME";
              return (
                <li key={item.id}>
                  <span className={income ? styles.incoming : styles.outgoing}>
                    <UiIcon
                      name={income ? "arrow-down-left" : "arrow-up-right"}
                    />
                  </span>
                  <div>
                    <strong>{item.title}</strong>
                    <time dateTime={item.occurredOn}>
                      {item.occurredOn.split("-").reverse().join(".")}
                    </time>
                  </div>
                  <b className={income ? styles.credit : styles.debit}>
                    {income ? "+" : "−"}
                    {formatPLN(item.amount)}
                  </b>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className={styles.empty}>
            <UiIcon name="receipt" />
            <strong>Brak transakcji</strong>
            <p>Po dodaniu operacji zobaczysz tu jej datę i kwotę.</p>
          </div>
        ))}
      <Link
        className={styles.inlineLink}
        scroll={false}
        href="/dashboard/transactions#history-heading"
      >
        Pełna historia <UiIcon name="arrow-right" />
      </Link>
    </section>
  );
}
