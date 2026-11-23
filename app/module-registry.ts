import type {LucideIcon} from 'lucide-react';
import {Activity,BookOpen,CalendarDays,ClipboardList,FileText,HardHat,Landmark,LayoutDashboard,Package,Receipt,SlidersHorizontal,Truck,Users,Wallet} from 'lucide-react';

export type EnterpriseModuleGroup={group:string;items:[string,LucideIcon][]};
export const enterpriseModuleGroups:EnterpriseModuleGroup[]=[
  {group:'OPERAÇÃO',items:[['Visão operacional',LayoutDashboard],['Field Service Cockpit',Activity],['Resource Planning Board',CalendarDays],['Ordens de serviço',ClipboardList],['Execução',HardHat],['Medições',SlidersHorizontal],['Clientes e propostas',Users],['Propostas e PO',FileText],['Contratos',FileText],['Frota e ativos',Truck],['Profissionais',HardHat]]},
  {group:'RELACIONAMENTO',items:[['CRM e Vendas',Users]]},
  {group:'GESTÃO INTEGRADA',items:[['Faturamento',Receipt],['Visão financeira',LayoutDashboard],['Financeiro',Wallet],['Fluxo de caixa',Wallet],['Tesouraria',Landmark],['Contas a pagar',Receipt],['Caixa e conciliação',Landmark],['Fiscal e tributos',FileText],['Contabilidade',BookOpen],['Razão contábil',BookOpen],['Fechamentos',CalendarDays],['Compras',Package],['Estoque e compras',Package]]},
];
export const enterpriseModuleDescription:Record<string,string>={
'Visão operacional':'Painel de controle da operação integrada, exceções prioritárias e próximos comandos autorizados.',
'Field Service Cockpit':'Fila operacional de ordens, equipes, prazos, capacidade e exceções em campo.',
'Resource Planning Board':'Planejamento temporal de recursos, alocações, conflitos e capacidade disponível.',
'Ordens de serviço':'Ciclo de vida das ordens, responsáveis, execução, medição, custo e rastreabilidade.',
'Execução':'Acompanhamento da execução em campo, apontamentos, ocorrências e evidências operacionais.',
'Medições':'Acompanhamento da produção realizada e das medições vinculadas às ordens de serviço.','Clientes e propostas':'Relacionamento comercial, solicitações, propostas e pedidos de compra.','Frota e ativos':'Disponibilidade, alocação e histórico dos recursos da operação.','Pessoas e equipes':'Equipes, responsáveis e vínculos com as ordens de serviço.','Faturamento':'Documentos de cobrança originados em medições aprovadas.','Financeiro':'Títulos a receber com origem, valor registrado e vencimento.','Caixa e conciliação':'Movimentação bancária, extratos e conciliação por transação.','Fiscal e tributos':'Documentos fiscais, períodos, obrigações e apuração.','Contabilidade':'Lançamentos, plano de contas, diário e fechamento.','Compras':'Fornecedores, aprovação de pedidos e recebimento integrado ao estoque.','Estoque e compras':'Controle de materiais, saldo e retiradas vinculadas às ordens de serviço.',
'Propostas e PO':'Propostas comerciais, pedidos de compra e conversão controlada para contratos.',
'Contratos':'Obrigações, vigência, aditivos, responsáveis, documentos e marcos de execução.',
'Profissionais':'Cadastro operacional, competências, disponibilidade e vínculos de alocação.',
'CRM e Vendas':'Leads, oportunidades, atividades e conversão comercial conectadas a clientes.',
'Visão financeira':'Indicadores financeiros, títulos em aberto, vencimentos e origem transacional.',
'Fluxo de caixa':'Projeção e realizado de entradas e saídas com rastreabilidade aos títulos.',
'Tesouraria':'Posições de caixa, contas bancárias, transferências e liquidez operacional.',
'Contas a pagar':'Obrigações de fornecedores, aprovações, vencimentos e pagamentos.',
'Razão contábil':'Movimentos por conta, centro de custo, período e documento de origem.',
'Fechamentos':'Controle de períodos, pendências, aprovações e encerramento contábil.',
};
export const enterpriseSpecializedWorkspaces=new Set(['CRM e Vendas','Clientes e propostas','Propostas e PO','Contratos','Execução','Visão financeira','Fluxo de caixa','Tesouraria','Contas a pagar','Caixa e conciliação','Razão contábil','Contabilidade','Fiscal e tributos','Fechamentos','Compras','Estoque e compras']);

/** The shell and command palette consume this derived contract, never ad-hoc labels. */
export const enterpriseModuleNames=enterpriseModuleGroups.flatMap(({items})=>items.map(([name])=>name));
export const enterpriseModuleNameSet=new Set(enterpriseModuleNames);
export function isEnterpriseModule(name:string){return enterpriseModuleNameSet.has(name);}
