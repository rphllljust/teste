'use client';

import type { ReactNode } from 'react';
import { ArrowRight, CheckCircle2, Layers3, ListChecks } from 'lucide-react';
import { EnterpriseButton } from './EnterprisePrimitives';

type Props = {
  activePage: string;
  group: string;
  onNavigate: (name: string) => void;
  children: ReactNode;
};

const domainStages: Record<string, string[]> = {
  'OPERAÇÃO': ['Entrada', 'Execução', 'Medição', 'Faturamento', 'Liquidação'],
  'PLANEJAMENTO E RECURSOS': ['Demanda', 'Capacidade', 'Alocação', 'Despacho', 'Acompanhamento'],
  'RELACIONAMENTO': ['Lead', 'Oportunidade', 'Proposta', 'Contrato', 'Cliente'],
  'FINANÇAS': ['Obrigações', 'Aprovação', 'Caixa', 'Conciliação', 'Fechamento'],
  'SUPRIMENTOS': ['Necessidade', 'Cotação', 'Pedido', 'Recebimento', 'Estoque'],
  'FISCAL E CONTABILIDADE': ['Documento', 'Escrituração', 'Validação', 'Razão', 'Fechamento'],
};

export function EnterpriseModuleWorkspace({ activePage, group, onNavigate, children }: Props) {
  const stages = domainStages[group] ?? domainStages['OPERAÇÃO'];
  const related = stages.filter(stage => stage.toLocaleLowerCase('pt-BR') !== activePage.toLocaleLowerCase('pt-BR')).slice(0, 3);
  return <section className="cisne-module-workspace" aria-label={`Workspace empresarial de ${activePage}`}>
    <header className="cisne-module-workspace-header">
      <div className="cisne-module-workspace-title">
        <span className="eyebrow"><Layers3 size={13} /> {group} · WORKSPACE EMPRESARIAL</span>
        <h2>{activePage}</h2>
        <p>Contexto, processo e próxima ação em uma única área de trabalho.</p>
      </div>
      <div className="cisne-module-workspace-actions">
        <span className="cisne-workspace-state"><CheckCircle2 size={14} /> Sessão autorizada</span>
        <EnterpriseButton type="button" appearance="subtle" onClick={() => onNavigate('Visão operacional')}>
          Visão geral <ArrowRight size={14} />
        </EnterpriseButton>
      </div>
    </header>
    <div className="cisne-module-process">
      <div className="cisne-module-process-label"><ListChecks size={15} /> Jornada do domínio</div>
      <div className="cisne-module-process-steps" role="list" aria-label="Etapas do processo empresarial">
        {stages.map((stage, index) => <button type="button" role="listitem" key={stage} className={index === 0 ? 'is-current' : ''} onClick={() => related[index - 1] && onNavigate(related[index - 1])}>
          <span>{String(index + 1).padStart(2, '0')}</span><strong>{stage}</strong>{index < stages.length - 1 && <ArrowRight size={13} aria-hidden="true" />}
        </button>)}
      </div>
    </div>
    <div className="cisne-module-workspace-body">
      <div className="cisne-module-workspace-content">{children}</div>
      <aside className="cisne-module-context" aria-label="Contexto empresarial">
        <span className="eyebrow">CONTEXTO ATIVO</span>
        <h3>Próxima ação</h3>
        <p>O sistema apresenta comandos conforme o estado real do registro e as permissões da sessão.</p>
        <div className="cisne-context-card"><strong>{activePage}</strong><small>Área atualmente selecionada</small></div>
        <div className="cisne-context-card"><strong>Rastreabilidade</strong><small>Histórico e vínculos permanecem no mesmo contexto.</small></div>
      </aside>
    </div>
  </section>;
}
