import type { Metadata } from "next";
import { FundamentalAnalysisChat } from "@/components/fundamental-analysis-chat";

export const metadata: Metadata = { title: "Analiza spółek — Finance" };

export default function Page() {
  return <FundamentalAnalysisChat />;
}
