'use client';

import { Building2, ChevronDown } from 'lucide-react';

const domains=[
 {label:'Início',items:['Visão operacional']},
 {label:'Comercial',items:['CRM e Vendas','Clientes e propostas','Propostas e PO']},
 {label:'Contratos',items:['Contratos']},
 {label:'Compras',items:['Compras','Estoque e compras']},
 {label:'Operações',items:['Ordens de serviço','Necessidades de serviço','Minha caixa de OS','Execução','Field Service Cockpit','Resource Planning Board']},
 {label:'Recursos',items:['Frota e ativos','Profissionais']},
 {label:'Medições',items:['Medições']},
 {label:'Faturamento',items:['Faturamento']},
 {label:'Financeiro',items:['Visão financeira','Financeiro','Fluxo de caixa','Tesouraria','Contas a pagar','Lotes de pagamentos','Cobrança e inadimplência','Caixa e conciliação']},
 {label:'Fiscal',items:['Fiscal e tributos']},
 {label:'Contabilidade',items:['Contabilidade','Razão contábil','Fechamentos']},
 {label:'Administração',items:['Governança empresarial','Dossiês empresariais']},
] as const;

export default function EnterpriseGlobalDomainNav({currentPage,navigate}:{
 currentPage:string;navigate:(module:string)=>void
}){
 return <nav className="cisne-enterprise-global-domains" aria-label="Domínios de negócio">
  <div className="cisne-enterprise-global-domains-label"><Building2 size={14}/> ERP Empresarial</div>
  <div className="cisne-enterprise-domain-scroll">
   {domains.map(domain=>{
    const active=domain.items.some(item=>item===currentPage);
    return domain.items.length===1?
     <button type="button" className={active?'is-active':''}
      key={domain.label} aria-current={active?'page':undefined}
      onClick={()=>navigate(domain.items[0])}>{domain.label}</button>
      :<details className={active?'is-active':''} key={domain.label}>
        <summary aria-label={domain.label+' — abrir módulos'}>{domain.label}<ChevronDown size={12}/></summary>
        <div className="cisne-enterprise-domain-dropdown" role="group" aria-label={'Módulos de '+domain.label}>
         {domain.items.map(item=><button key={item} type="button"
          aria-current={currentPage===item?'page':undefined} onClick={e=>{
            e.currentTarget.closest('details')?.removeAttribute('open');navigate(item);
          }}>{item}</button>)}
        </div>
       </details>;
   })}
  </div>
 </nav>
}
