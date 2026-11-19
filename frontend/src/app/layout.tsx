import type { Metadata } from "next";
import "@fontsource-variable/dm-sans";
import "@phosphor-icons/web/regular";
import "./globals.css";
import { SessionProvider } from "@/components/session-provider";

export const metadata: Metadata = {
  title: "Finance — finanse osobiste",
  description: "Portfel osobisty, transakcje, analityka i inwestycje w jednym miejscu.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pl">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
