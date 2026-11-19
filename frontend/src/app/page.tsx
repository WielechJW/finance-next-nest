import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { UiIcon } from "@/components/ui-icon";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Finance — Twój portfel",
  description:
    "Prowadź domowy budżet, sprawdzaj wydatki i śledź swoje inwestycje.",
};

const features = [
  {
    icon: "arrows-left-right",
    label: "Transakcje",
    detail: "Przychody i wydatki z historią operacji i filtrami.",
  },
  {
    icon: "chart-donut",
    label: "Analityka",
    detail: "Wydatki według kategorii i zmiany salda w czasie.",
  },
  {
    icon: "chart-line-up",
    label: "Inwestycje",
    detail: "Rachunki GPW i USA, wyceny oraz alerty cenowe.",
  },
];

export default function Home() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="Finance">
          <Brand />
        </Link>
        <Link href="/dashboard" className={styles.panelLink}>
          Przejdź do panelu <UiIcon name="arrow-up-right" />
        </Link>
      </header>
      <section className={styles.hero} aria-labelledby="welcome-heading">
        <div className={styles.copy}>
          <h1 id="welcome-heading">
            Twój portfel <em>w jednym miejscu</em>
          </h1>
          <p>
            Zapisuj codzienne wydatki, sprawdzaj saldo i śledź inwestycje w
            jednym panelu.
          </p>
          <nav className={styles.actions} aria-label="Dostęp do konta">
            <Link className={styles.primary} href="/login">
              Zaloguj się <UiIcon name="arrow-right" />
            </Link>
            <Link className={styles.secondary} href="/register">
              Zarejestruj się
            </Link>
          </nav>
        </div>
        <div className={styles.art}>
          <Image
            src="/finance-still-life.webp"
            fill
            preload
            sizes="(max-width: 700px) 95vw, 47vw"
            alt=""
          />
        </div>
      </section>
      <section className={styles.features} aria-label="Funkcje aplikacji">
        {features.map((feature) => (
          <article key={feature.label}>
            <span className={styles.icon}>
              <UiIcon name={feature.icon} />
            </span>
            <div>
              <h2>{feature.label}</h2>
              <p>{feature.detail}</p>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
