import { InvestmentsPanel } from "@/components/investments/investments-panel";
export default async function PortfolioPage({
  params,
}: {
  params: Promise<{ portfolioId: string }>;
}) {
  const { portfolioId } = await params;
  return <InvestmentsPanel portfolioId={portfolioId} />;
}
