import type { Metadata } from "next";
import Link from "next/link";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Finance — Twój portfel",
  description: "Zaloguj się lub utwórz konto, aby zacząć prowadzić swój portfel.",
};

export default function Home() {
  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="welcome-heading">
        <p className={styles.brand}>Finance</p>
        <h1 id="welcome-heading">Twój portfel w jednym miejscu</h1>
        <p className={styles.intro}>
          Witaj! Zaloguj się do swojego portfela lub utwórz konto, jeśli jesteś
          tutaj po raz pierwszy.
        </p>

        <nav className={styles.actions} aria-label="Dostęp do konta">
          <Link className={styles.primary} href="/login">
            Zaloguj się
          </Link>
          <Link className={styles.secondary} href="/register">
            Zarejestruj się
          </Link>
        </nav>
      </section>
    </main>
  );
}
