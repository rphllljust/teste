import type { Metadata } from "next";
import "./globals.css";
import "./mrp.css";
import "./components/enterprise/enterprise-tokens.css";
import "./components/enterprise/enterprise-foundation.css";
import "./components/enterprise/enterprise-experience.css";

export const metadata: Metadata = {
  title: "Cisne Rondônia | ERP",
  description: "Ordens de serviço e gestão empresarial integrada.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
