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
import "./components/enterprise/enterprise-execution-workbench.css";
import "./components/enterprise/enterprise-operations-workbench.css";
import "./components/enterprise/enterprise-service-order-control.css";
import "./components/enterprise/enterprise-os-workplan.css";
import "./components/enterprise/enterprise-os-wizard-tier1.css";
import "./components/enterprise/enterprise-operations-tier1.css";
import "./components/enterprise/enterprise-finance-tier1.css";
import "./components/enterprise/enterprise-finance-command.css";
import "./components/enterprise/enterprise-finance-compact.css";
import "./components/enterprise/enterprise-finance-report.css";
import "./components/enterprise/enterprise-project-costs.css";
import "./components/enterprise/enterprise-procure-dossier.css";
import "./components/enterprise/enterprise-procure-portfolio.css";
import "./components/enterprise/enterprise-exceptions.css";
import "./components/enterprise/enterprise-finance-preflight.css";

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
