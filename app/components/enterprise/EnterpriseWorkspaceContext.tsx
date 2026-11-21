'use client';

import { ArrowUpRight, Network } from 'lucide-react';
import { EnterpriseButton } from './EnterprisePrimitives';

// Navigation is intentionally cross-module: these destinations are existing
// workspaces, not mocked tasks or invented financial commands.
export const enterpriseRelatedWorkspaces: Record<string, readonly string[]> = {
  'Visão operacional': ['Centro de operações', 'Ordens de serviço', 'Financeiro'],
  'Centro de operações': ['Ordens de serviço', 'Execução', 'Medições'],
  'Ordens de serviço': ['Centro de operações', 'Execução', 'Medições'],
  'Execução': ['Ordens de serviço', 'Medições', 'Field Service Cockpit'],
  'Medições': ['Ordens de serviço', 'Faturamento', 'Financeiro'],
  'Field Service Cockpit': ['Ordens de serviço', 'Resource Planning Board', 'Execução'],
  'Resource Planning Board': ['Profissionais', 'Frota e ativos', 'Ordens de serviço'],
  'Profissionais': ['Resource Planning Board', 'Field Service Cockpit', 'Ordens de serviço'],
  'Frota e ativos': ['Resource Planning Board', 'Ordens de serviço', 'Compras'],
  'CRM e Vendas': ['Clientes e propostas', 'Propostas e PO', 'Contratos'],
  'Clientes e propostas': ['CRM e Vendas', 'Propostas e PO', 'Contratos'],
  'Propostas e PO': ['Clientes e propostas', 'Contratos', 'Ordens de serviço'],
  'Contratos': ['Propostas e PO', 'Ordens de serviço', 'Clientes e propostas'],
  'Faturamento': ['Medições', 'Financeiro', 'Fiscal e tributos'],
  'Visão financeira': ['Financeiro', 'Fluxo de caixa', 'Contas a pagar'],
  'Financeiro': ['Visão financeira', 'Tesouraria', 'Caixa e conciliação'],
  'Fluxo de caixa': ['Tesouraria', 'Contas a pagar', 'Financeiro'],
  'Tesouraria': ['Fluxo de caixa', 'Caixa e conciliação', 'Financeiro'],
  'Contas a pagar': ['Tesouraria', 'Caixa e conciliação', 'Compras'],
  'Caixa e conciliação': ['Tesouraria', 'Financeiro', 'Contabilidade'],
  'Compras': ['Estoque e compras', 'Contas a pagar', 'Frota e ativos'],
  'Estoque e compras': ['Compras', 'Resource Planning Board', 'Ordens de serviço'],
  'Fiscal e tributos': ['Faturamento', 'Contabilidade', 'Fechamentos'],
  'Contabilidade': ['Razão contábil', 'Fechamentos', 'Fiscal e tributos'],
  'Razão contábil': ['Contabilidade', 'Fechamentos', 'Visão financeira'],
  'Fechamentos': ['Contabilidade', 'Razão contábil', 'Fiscal e tributos'],
};

type Props = {
  activePage: string;
  onNavigate: (page: string) => void;
};

export function EnterpriseWorkspaceContext({ activePage, onNavigate }: Props) {
  const related = enterpriseRelatedWorkspaces[activePage] ?? [];
  if (!related.length) return null;

  return (
    <nav className="enterprise-workflow-context" aria-label="Fluxos empresariais relacionados">
      <div className="enterprise-workflow-context-heading">
        <Network size={17} aria-hidden="true" />
        <span>Trabalho relacionado</span>
      </div>
      <div className="enterprise-workflow-context-actions" aria-label="Acessar outros módulos do processo">
        {related.map(name => (
          <EnterpriseButton
            type="button"
            appearance="subtle"
            className="enterprise-workflow-link"
            key={name}
            onClick={() => onNavigate(name)}
            aria-label={`Abrir ${name}`}
          >
            <span>{name}</span>
            <ArrowUpRight size={14} aria-hidden="true" />
          </EnterpriseButton>
        ))}
      </div>
    </nav>
  );
}
