import type { Metadata } from "next";
import { TransactionsPanel } from "@/components/transactions-panel";

export const metadata: Metadata = { title: "Transakcje — Finance" };

export default function TransactionsPage() {
  return <TransactionsPanel />;
}
