import type { Metadata } from "next";
import { InvestmentsPanel } from "@/components/investments/investments-panel";
export const metadata: Metadata = { title: "Inwestycje — Finance" };
export default function InvestmentsPage() {
  return <InvestmentsPanel />;
}
