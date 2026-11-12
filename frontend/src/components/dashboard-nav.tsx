"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./dashboard-nav.module.css";

export function DashboardNav() {
  const pathname = usePathname();
  const active = pathname === "/dashboard/wallet";
  return (
    <nav className={styles.nav} aria-label="Nawigacja panelu">
      <Link href="/dashboard/wallet" aria-current={active ? "page" : undefined}>
        Portfel
      </Link>
      <Link
        href="/dashboard/transactions"
        aria-current={
          pathname === "/dashboard/transactions" ? "page" : undefined
        }
      >
        Transakcje
      </Link>
    </nav>
  );
}
