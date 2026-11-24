import type { Metadata } from "next";
import { PaperPanel } from "@/components/investments/paper-panel";

export const metadata: Metadata = { title: "Lokalny symulator — Finance" };

export default async function PaperPage({
  searchParams,
}: {
  searchParams: Promise<{ signal?: string | string[] }>;
}) {
  const { signal } = await searchParams;
  return (
    <PaperPanel signalId={typeof signal === "string" ? signal : undefined} />
  );
}
