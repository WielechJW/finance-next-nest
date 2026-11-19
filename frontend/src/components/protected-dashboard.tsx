"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api-client";
import { useSession } from "./session-provider";
import { Brand } from "./brand";
import { UiIcon } from "./ui-icon";
import { DashboardNav, DashboardLocation } from "./dashboard-nav";
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
          <p className={styles.brand}>
            <Brand />
          </p>
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
      <a className={styles.skip} href="#panel-content">
        Przejdź do treści
      </a>
      <aside className={styles.sidebar} aria-label="Menu aplikacji">
        <Link href="/" className={styles.brand} aria-label="Finance">
          <Brand />
        </Link>
        <DashboardNav />
        <div className={styles.account}>
          <span className={styles.avatar} aria-hidden="true">
            {state.user.email.slice(0, 1).toUpperCase()}
          </span>
          <div className={styles.identity}>
            <span>Moje konto</span>
            <p title={state.user.email}>{state.user.email}</p>
          </div>
          <button
            type="button"
            title="Wyloguj się"
            aria-label={isLoggingOut ? "Wylogowywanie…" : "Wyloguj się"}
            onClick={() => void logout()}
            disabled={isLoggingOut}
          >
            <UiIcon name="sign-out" />
          </button>
        </div>
      </aside>
      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <div className={styles.location}>
            <UiIcon name="squares-four" />
            <span>Panel</span>
            <UiIcon name="caret-right" />
            <DashboardLocation />
          </div>
          <time
            dateTime={new Intl.DateTimeFormat("sv-SE", {
              timeZone: "Europe/Warsaw",
            }).format(new Date())}
          >
            <UiIcon name="calendar-blank" />
            {new Intl.DateTimeFormat("pl-PL", {
              day: "numeric",
              month: "long",
              year: "numeric",
              timeZone: "Europe/Warsaw",
            }).format(new Date())}
          </time>
        </header>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <main className={styles.content} id="panel-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
