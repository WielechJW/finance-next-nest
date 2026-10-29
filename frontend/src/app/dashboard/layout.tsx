import type { Metadata } from "next";
import { ProtectedDashboard } from "@/components/protected-dashboard";

export const metadata: Metadata = { title: "Panel — Finance" };

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ProtectedDashboard>{children}</ProtectedDashboard>;
}
