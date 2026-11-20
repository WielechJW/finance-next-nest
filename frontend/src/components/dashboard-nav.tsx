"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UiIcon } from "./ui-icon";
import styles from "./dashboard-nav.module.css";

const sections = [
  { href: "/dashboard/wallet", label: "Portfel", icon: "wallet" },
  {
    href: "/dashboard/transactions",
    label: "Transakcje",
    icon: "arrows-left-right",
  },
  { href: "/dashboard/analytics", label: "Analityka", icon: "chart-donut" },
  {
    href: "/dashboard/investments",
    label: "Inwestycje",
    icon: "chart-line-up",
  },
  { href: "/dashboard/market", label: "Rynek i alerty", icon: "bell-ringing" },
  {
    href: "/dashboard/fundamental-analysis",
    label: "Analiza spółek",
    icon: "file-magnifying-glass",
  },
];

export function DashboardNav() {
  const pathname = usePathname();
  return (
    <nav className={styles.nav} aria-label="Nawigacja panelu">
      {sections.map(({ href, label, icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={
            pathname === href || pathname.startsWith(href + "/")
              ? "page"
              : undefined
          }
        >
          <UiIcon name={icon} />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}

export function DashboardLocation() {
  const pathname = usePathname();
  return (
    <span>
      {sections.find(
        ({ href }) => pathname === href || pathname.startsWith(href + "/"),
      )?.label ?? "Panel"}
    </span>
  );
}
