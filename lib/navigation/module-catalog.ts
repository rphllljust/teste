export type ModuleRoute = {
  id: string;
  label: string;
  aliases?: readonly string[];
  group: string;
};

export type ModuleGroup = {
  id: string;
  label: string;
  routes: readonly ModuleRoute[];
};

export const moduleCatalog = [
  {
    id: "operations",
    label: "INÍCIO E OPERAÇÃO",
    routes: [
      { id: "operational-overview", label: "Visão operacional", group: "operations" },
      { id: "field-service-cockpit", label: "Field Service Cockpit", group: "operations" },
      { id: "resource-planning", label: "Resource Planning Board", group: "operations" },
      { id: "service-orders", label: "Ordens de serviço", group: "operations" },
      { id: "execution", label: "Execução", group: "operations" },
      { id: "measurements", label: "Medições", group: "operations" },
    ],
  },
  {
    id: "commercial",
    label: "COMERCIAL E RELACIONAMENTO",
    routes: [
      { id: "crm-sales", label: "CRM e Vendas", group: "commercial" },
      { id: "clients-proposals", label: "Clientes e propostas", group: "commercial" },
      { id: "proposals-purchase-orders", label: "Propostas e PO", group: "commercial" },
    ],
  },
  {
    id: "supply",
    label: "CONTRATOS E SUPRIMENTOS",
    routes: [
      { id: "contracts", label: "Contratos", group: "supply" },
      { id: "procurement", label: "Compras", group: "supply" },
      { id: "inventory-procurement", label: "Estoque e compras", group: "supply" },
    ],
  },
  {
    id: "resources",
    label: "RECURSOS E LOGÍSTICA",
    routes: [
      { id: "assets", label: "Frota e ativos", group: "resources" },
      { id: "professionals", label: "Profissionais", group: "resources" },
    ],
  },
  {
    id: "finance-control",
    label: "FINANCEIRO E CONTROLADORIA",
    routes: [
      { id: "billing", label: "Faturamento", group: "finance-control" },
      { id: "finance-overview", label: "Visão financeira", group: "finance-control" },
      { id: "finance", label: "Financeiro", group: "finance-control" },
      { id: "cash-flow", label: "Fluxo de caixa", group: "finance-control" },
      { id: "treasury", label: "Tesouraria", group: "finance-control" },
      { id: "payables", label: "Contas a pagar", group: "finance-control" },
      { id: "bank-reconciliation", label: "Caixa e conciliação", group: "finance-control" },
      { id: "fiscal", label: "Fiscal e tributos", group: "finance-control" },
      { id: "accounting", label: "Contabilidade", group: "finance-control" },
      { id: "ledger", label: "Razão contábil", group: "finance-control" },
      { id: "closing", label: "Fechamentos", group: "finance-control" },
    ],
  },
] as const satisfies readonly ModuleGroup[];

export const moduleRoutes = moduleCatalog.flatMap((group) => group.routes);

export function findModuleRoute(value: string | null | undefined): ModuleRoute | undefined {
  if (!value) return moduleRoutes.find((route) => route.id === "operational-overview");
  return moduleRoutes.find(
    (route) => route.id === value || route.label === value || route.aliases?.includes(value),
  );
}

export function routeHash(route: ModuleRoute): string {
  return "#" + encodeURIComponent(route.label);
}
