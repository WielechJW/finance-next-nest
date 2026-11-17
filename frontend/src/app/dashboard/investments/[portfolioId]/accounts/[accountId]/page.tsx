import { InvestmentsPanel } from "@/components/investments/investments-panel";
export default async function InvestmentAccountPage({
  params,
}: {
  params: Promise<{ portfolioId: string; accountId: string }>;
}) {
  const { portfolioId, accountId } = await params;
  return <InvestmentsPanel portfolioId={portfolioId} accountId={accountId} />;
}
