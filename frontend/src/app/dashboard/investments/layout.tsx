import type { Metadata } from "next";
export const metadata: Metadata = { title: "Inwestycje — Finance" };
export default function InvestmentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
