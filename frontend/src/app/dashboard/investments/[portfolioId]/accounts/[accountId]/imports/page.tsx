import type { Metadata } from "next";
import { InvestmentImports } from "@/components/investments/investment-imports";

export const metadata: Metadata = { title: "Import historii — Finance" };

export default async function Page({
  params,
}: {
  params: Promise<{ portfolioId: string; accountId: string }>;
}) {
  const { portfolioId, accountId } = await params;
  return <InvestmentImports portfolioId={portfolioId} accountId={accountId} />;
}
