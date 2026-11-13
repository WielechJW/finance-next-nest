import type { Metadata } from "next";
import { AnalyticsPanel } from "@/components/analytics-panel";

export const metadata: Metadata = { title: "Analityka — Finance" };
export default function AnalyticsPage() {
  return <AnalyticsPanel />;
}
