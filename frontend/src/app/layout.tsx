import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Finance — nauka Next.js",
  description: "Projekt do nauki TypeScript, Next.js i NestJS",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
