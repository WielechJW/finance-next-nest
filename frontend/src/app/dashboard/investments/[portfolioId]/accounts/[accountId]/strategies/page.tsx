import type { Metadata } from "next";
import { InvestmentStrategies } from "@/components/investments/investment-strategies";

export const metadata: Metadata = { title: "Strategie sygnałowe — Finance" };

export default async function Page({
  params,
}: {
  params: Promise<{ portfolioId: string; accountId: string }>;
}) {
  const { portfolioId, accountId } = await params;
  return (
    <InvestmentStrategies portfolioId={portfolioId} accountId={accountId} />
  );
}
