"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api-client";
import { useSession } from "./session-provider";
import { DashboardNav } from "./dashboard-nav";
import styles from "./protected-dashboard.module.css";

export function ProtectedDashboard({ children }: { children: ReactNode }) {
  const { state, store } = useSession();
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);

  useEffect(() => {
    if (state.status === "unauthenticated") router.replace("/login");
  }, [state.status, router]);

  async function logout() {
    if (pending.current) return;
    pending.current = true;
    setIsLoggingOut(true);
    setError("");
    try {
      await store.logout();
      router.replace("/login");
      router.refresh();
    } catch (failure) {
      setError(
        failure instanceof ApiError
          ? failure.message
          : "Nie udało się wylogować. Spróbuj ponownie.",
      );
    } finally {
      pending.current = false;
      setIsLoggingOut(false);
    }
  }

  if (state.status !== "authenticated") {
    return (
      <main className={styles.statusPage}>
        <section
          className={styles.statusCard}
          aria-labelledby="session-heading"
        >
          <p className={styles.brand}>Finance</p>
          <h1 id="session-heading">Twój panel</h1>
          {state.status === "error" ? (
            <>
              <p role="alert">{state.error}</p>
              <button type="button" onClick={() => void store.refresh()}>
                Spróbuj ponownie
              </button>
              <Link href="/login">Przejdź do logowania</Link>
            </>
          ) : (
            <p role="status">
              {state.status === "loading"
                ? "Sprawdzanie sesji…"
                : "Przekierowywanie do logowania…"}
            </p>
          )}
        </section>
      </main>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>
          Finance
        </Link>
        <div className={styles.account}>
          <div>
            <span className={styles.label}>Zalogowany użytkownik</span>
            <p className={styles.email}>{state.user.email}</p>
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            disabled={isLoggingOut}
          >
            {isLoggingOut ? "Wylogowywanie…" : "Wyloguj się"}
          </button>
        </div>
      </header>
      <DashboardNav />
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <main className={styles.content}>{children}</main>
    </div>
  );
}
