import { MarketInstrument } from '@/components/investments/market-center';
export default async function Page({ params }: { params: Promise<{ instrumentId: string }> }) {
  const { instrumentId } = await params;
  return <MarketInstrument instrumentId={instrumentId} />;
}
