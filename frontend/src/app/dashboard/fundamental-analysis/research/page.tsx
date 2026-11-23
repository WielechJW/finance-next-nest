import type { Metadata } from "next";
import { InvestmentResearch } from "@/components/investments/investment-research";

export const metadata: Metadata = {
  title: "Screener i porównanie spółek — Finance",
};

export default function Page() {
  return <InvestmentResearch />;
}
