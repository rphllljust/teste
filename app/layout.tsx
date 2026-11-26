import type { Metadata } from "next";
import "./globals.css";
import "./mrp.css";
import "./components/enterprise/enterprise-tokens.css";
import "./components/enterprise/enterprise-foundation.css";
import "./components/enterprise/enterprise-experience.css";
import "./components/enterprise/enterprise-governance.css";
import "./components/enterprise/enterprise-dossier.css";
import "./components/enterprise/enterprise-resource-planning.css";
import "./components/enterprise/enterprise-workbench.css";
import "./components/enterprise/enterprise-operations-workbench.css";

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
