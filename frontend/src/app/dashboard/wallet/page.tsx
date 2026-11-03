import type { Metadata } from "next";
import { WalletPanel } from "@/components/wallet-panel";

export const metadata: Metadata = { title: "Portfel — Finance" };

export default function WalletPage() {
  return <WalletPanel />;
}
