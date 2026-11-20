import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = new URL('../', import.meta.url);
const app = new URL('../app/', import.meta.url);
// Reconciled against the actual dispatch in app/page.tsx at the evaluated SHA.
// "contextual-command" and "embedded-workspace" are NOT direct menu destinations.
const entryPoints = {
  AccountingWorkspace:['Contabilidade','navigation'],
  AssetsWorkspace:['Frota e ativos','navigation'],
  BankReconciliationWorkspace:['Caixa e conciliação','navigation'],
  BillingPreparation:['Faturamento','contextual-command'],
  CRMWorkspace:['CRM e Vendas','navigation'],
  CashFlowWorkspace:['Fluxo de caixa','navigation'],
  ClientsWorkspace:['Clientes e propostas','navigation'],
  CloseCenterWorkspace:['Fechamentos','navigation'],
  ContractsWorkspace:['Contratos','navigation'],
  ExecutionWorkspace:['Execução','navigation'],
  FieldServiceCockpit:['Field Service Cockpit','navigation'],
  FinanceOverviewWorkspace:['Visão financeira','navigation'],
  FiscalWorkspace:['Fiscal e tributos','navigation'],
  InventoryWorkspace:['Estoque e compras','navigation-tab'],
  LedgerWorkspace:['Razão contábil','navigation'],
  MRPWorkspace:['Estoque e compras','navigation-tab'],
  MeasurementPreparation:['Medições','contextual-command'],
  OrderNextcrmDocuments:['Ordens de serviço','object-section'],
  OrderPreparation:['Ordens de serviço','contextual-command'],
  PayablesWorkspace:['Contas a pagar','navigation'],
  ProcurementWorkspace:['Compras','navigation'],
  ProfessionalsWorkspace:['Profissionais','navigation'],
  ProposalsWorkspace:['Propostas e PO','navigation'],
  ResourcePlanningBoard:['Resource Planning Board','navigation'],
  ServiceOperationsAgenda:['Ordens de serviço','embedded-workspace'],
  ServiceOperationsWorkspace:['Centro de operações','navigation'],
  TreasuryWorkspace:['Tesouraria','navigation'],
};

const workspacePattern = /(?:Workspace|Cockpit|Board|Agenda|Preparation|Documents)\.tsx$/;

export async function auditEnterpriseWorkspaces() {
  const page = await readFile(new URL('app/page.tsx', root), 'utf8');
  const files = (await readdir(app, { withFileTypes: true }))
    .filter(entry => entry.isFile() && workspacePattern.test(entry.name))
    .map(entry => entry.name)
    .sort();

  const navStart = page.indexOf('const modules:');
  const navEnd = page.indexOf('const chain =', navStart);
  if (navStart < 0 || navEnd < navStart) throw new Error('Navigation registry not found');
  const lines = page.slice(navStart, navEnd).split('\n').map(line => line.replace(/\/\/.*$/, ''));
  const navigation = [...new Set(lines.flatMap(line => {
    const match = line.match(/\[\s*["']([^"']+)["']\s*,\s*[A-Z][\w]*\s*\]/);
    return match ? [match[1]] : [];
  }))];

  const imports = new Map([...page.matchAll(/^import\s+([A-Za-z][\w]*)(?:,\s*\{[^}]+\})?\s+from\s+["']\.\/([A-Za-z][\w]*)["'];/gm)]
    .map(match => [match[2] + '.tsx', match[1]]));

  const workspaces = await Promise.all(files.map(async file => {
    const alias = imports.get(file) ?? null;
    const workspace = await readFile(new URL(file, app), 'utf8');
    const usedInRoot = Boolean(alias && new RegExp('<' + alias + '(?:\\s|\\/|>)').test(page));
    const name=file.slice(0,-4);
    const entry=entryPoints[name];
    if(!entry)throw new Error('Unclassified workspace: '+name);
    const [navigationLabel,accessMode]=entry;
    if(!navigation.includes(navigationLabel))throw new Error('Unrecognized workspace navigation: '+name);
    const apiPrefixes=[...new Set([...workspace.matchAll(/['"](\/api\/[a-z][\w/-]*)/gi)].map(m=>m[1]))].sort();
    const hasGrid=/<EnterpriseDataGrid\b/.test(workspace);
    const hasObjectPage=/<EnterpriseObjectPage\b/.test(workspace);
    return {
      file:'app/'+file,
      name,
      rootImport:alias,
      mountedInRoot:usedInRoot,
      entryPoint:{navigationLabel,accessMode,verified:usedInRoot},
      fluentRendered:/<Enterprise(?:Button|Input|Textarea|Checkbox|Dropdown|SearchField|SelectField|DataGrid|FilterBar|ObjectPage|PageHeader)\b/.test(workspace),
      objectPagePattern:hasObjectPage,
      fluentGridPattern:hasGrid,
      fioriEvidence:hasObjectPage?'ObjectPage source only':hasGrid?'DataGrid source only':'Specialized source only',
      redwoodEvidence:/onOpen(?:Order)?\b|onNavigate\b|onDrilldown\b/.test(workspace)?'navigation callbacks in source':'not evidenced',
      formsPresent:/<form\b|<EnterpriseDialog\b/.test(workspace),
      filtersPresent:/<Enterprise(?:FilterBar|ListReportFilters|SearchField|Dropdown|SelectField)\b/.test(workspace),
      commandsPresent:/availableCommands|onCreate|onSubmit|onClick/.test(workspace),
      apiPrefixes,
      actualPersistence:'UNTESTED',
      authenticatedAuthorization:'UNTESTED',
      realBusinessJourney:'UNTESTED',
      screenshot:{desktop:'UNTESTED',tablet:'UNTESTED',mobile:'UNTESTED'},
      browserHomologated:false,
      stagingHomologated:false,
      acceptance:'NOT_TESTED',
    };
  }));

  return {
    source: 'repository code, not production deployment',
    navigationEntries: navigation,
    totalNavigationEntries: navigation.length,
    totalWorkspaceFiles: workspaces.length,
    totalMountedInRoot: workspaces.filter(entry => entry.mountedInRoot).length,
    unmountedFiles: workspaces.filter(entry => !entry.mountedInRoot).map(entry => entry.file),
    verifiedAuthenticated: 0,
    fullyHomologated: 0,
    workspaces,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await auditEnterpriseWorkspaces();
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (process.argv.includes('--strict') && report.unmountedFiles.length) process.exitCode = 1;
}
