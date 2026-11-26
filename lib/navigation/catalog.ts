export type ModuleIconKey = "accounting"|"activity"|"assets"|"billing"|"calendar"|"dashboard"|"field"|"file"|"finance"|"inventory"|"orders"|"people"|"procurement";
export type ModuleNavItem = { readonly id: string; readonly label: string; readonly icon: ModuleIconKey };
export type ModuleGroup = { readonly id: string; readonly label: string; readonly items: readonly ModuleNavItem[] };
const item=(id:string,label:string,icon:ModuleIconKey):ModuleNavItem=>({id,label,icon});
export const moduleGroups: readonly ModuleGroup[]=[
 {id:"operations",label:"INÍCIO E OPERAÇÃO",items:[item("operational-view","Visão operacional","dashboard"),item("enterprise-dossiers","Dossiês empresariais","file"),item("field-service-cockpit","Field Service Cockpit","activity"),item("resource-planning","Resource Planning Board","calendar"),item("service-orders","Ordens de serviço","orders"),item("execution","Execução","field"),item("measurements","Medições","procurement")]},
 {id:"commercial",label:"COMERCIAL E RELACIONAMENTO",items:[item("crm","CRM e Vendas","people"),item("clients-proposals","Clientes e propostas","people"),item("proposals-purchase-orders","Propostas e PO","file")]},
 {id:"supply",label:"CONTRATOS E SUPRIMENTOS",items:[item("contracts","Contratos","file"),item("purchases","Compras","procurement"),item("inventory-purchases","Estoque e compras","inventory")]},
 {id:"resources",label:"RECURSOS E LOGÍSTICA",items:[item("assets","Frota e ativos","assets"),item("professionals","Profissionais","field")]},
 {id:"finance",label:"FINANCEIRO E CONTROLADORIA",items:[item("billing","Faturamento","billing"),item("finance-overview","Visão financeira","dashboard"),item("finance","Financeiro","finance"),item("cash-flow","Fluxo de caixa","finance"),item("treasury","Tesouraria","accounting"),item("payables","Contas a pagar","billing"),item("bank-reconciliation","Caixa e conciliação","accounting"),item("fiscal","Fiscal e tributos","file"),item("accounting","Contabilidade","accounting"),item("ledger","Razão contábil","accounting"),item("close","Fechamentos","calendar")]}
];
export const moduleItems=moduleGroups.flatMap((group)=>group.items);
const moduleLabels=new Set(moduleItems.map((entry)=>entry.label));
export function isModuleLabel(label:string){return moduleLabels.has(label);}
export function moduleHash(label:string){return isModuleLabel(label)?"#"+encodeURIComponent(label):"#";}
export function moduleFromHash(hash:string){const raw=hash.startsWith("#")?hash.slice(1):hash;const decoded=raw?decodeURIComponent(raw):"Visão operacional";return isModuleLabel(decoded)?decoded:"Visão operacional";}
