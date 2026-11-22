'use client';

import { useState } from 'react';
import {
  ArrowRightRegular, CalendarClockRegular, ChartMultipleRegular,
  ClipboardTaskRegular, DocumentBulletListRegular, GridRegular,
  PeopleTeamRegular, BoxRegular, ShieldCheckmarkRegular,
  SparkleRegular, AddRegular, OpenRegular, ChevronRightRegular,
  CheckmarkCircleRegular, MoneyRegular, WrenchRegular,
} from '@fluentui/react-icons';
import { EnterpriseButton } from './components/enterprise/EnterprisePrimitives';
import ServiceOperationsWorkspace from './ServiceOperationsWorkspace';
import EnterpriseControlTower, { type ControlTowerLaneId } from './EnterpriseControlTower';

type Props = {
  summary: { total: number; drafts: number; planned: number; pendingMeasurements: number };
  dataState: 'loading' | 'unavailable' | 'ready';
  navigate: (name: string) => void;
  onCreate: () => void;
  onPendingMeasurements: () => void;
  onOpenOrder: (id: string) => void;
  onControlTowerLane: (lane: ControlTowerLaneId, asOf: string) => void;
  onControlTowerRecord: (lane: ControlTowerLaneId, id: string, asOf: string) => void;
};

const journeys = [
  { code: '01', title: 'Operação', subtitle: 'Da ordem à execução', detail: 'Ordens, atividades, medições e continuidade do serviço.', target: 'Centro de operações', Icon: ClipboardTaskRegular, tone: 'blue' },
  { code: '02', title: 'Relacionamento', subtitle: 'Do cliente ao contrato', detail: 'Clientes, propostas, CRM e compromissos comerciais.', target: 'Clientes e propostas', Icon: PeopleTeamRegular, tone: 'indigo' },
  { code: '03', title: 'Planejamento', subtitle: 'Recursos e capacidade', detail: 'Equipes, ativos, agenda e disponibilidade operacional.', target: 'Resource Planning Board', Icon: WrenchRegular, tone: 'teal' },
  { code: '04', title: 'Finanças', subtitle: 'Do faturamento ao caixa', detail: 'Obrigações, recebíveis, conciliação e tesouraria.', target: 'Visão financeira', Icon: MoneyRegular, tone: 'green' },
  { code: '05', title: 'Suprimentos', subtitle: 'Compras e materiais', detail: 'Solicitações, abastecimento, estoque e entregas.', target: 'Compras', Icon: BoxRegular, tone: 'amber' },
  { code: '06', title: 'Governança', subtitle: 'Fiscal e contabilidade', detail: 'Documentos, lançamentos, razão e fechamentos.', target: 'Contabilidade', Icon: DocumentBulletListRegular, tone: 'violet' },
] as const;

const process = [
  { title: 'Ordens de serviço', detail: 'Solicitação' },
  { title: 'Execução', detail: 'Realização' },
  { title: 'Medições', detail: 'Evidências' },
  { title: 'Faturamento', detail: 'Cobrança' },
  { title: 'Financeiro', detail: 'Liquidação' },
] as const;

export default function EnterpriseCommandCenter({
  summary, dataState, navigate, onCreate, onOpenOrder,
  onPendingMeasurements, onControlTowerLane, onControlTowerRecord,
}: Props) {
  const [showOperations, setShowOperations] = useState(false);
  const [showPriorities, setShowPriorities] = useState(false);
  const isReady = dataState === 'ready';

  const metrics = [
    { label: 'Ordens no contexto', value: summary.total, target: 'Ordens de serviço', Icon: ClipboardTaskRegular, explanation: 'Abrir a carteira operacional', onActivate: () => navigate('Ordens de serviço') },
    { label: 'Em planejamento', value: summary.planned, target: 'Centro de operações', Icon: CalendarClockRegular, explanation: 'Consultar a programação', onActivate: () => navigate('Centro de operações') },
    { label: 'Aguardando medição', value: summary.pendingMeasurements, target: 'Medições', Icon: ChartMultipleRegular, explanation: 'Revisar produção pendente', onActivate: onPendingMeasurements },
    { label: 'Rascunhos', value: summary.drafts, target: 'Ordens de serviço', Icon: DocumentBulletListRegular, explanation: 'Retomar registros iniciados', onActivate: () => navigate('Ordens de serviço') },
  ] as const;

  return (
    <section className="enterprise-command-center cisne-command-v2" aria-label="Centro de comando empresarial">
      <div className="cisne-command-hero">
        <div className="cisne-command-hero-content">
          <div className="cisne-command-overline">
            <SparkleRegular fontSize={17} aria-hidden="true" />
            NOVA ÁREA DE TRABALHO · CISNE ERP
          </div>
          <h2>O negócio inteiro, em uma só visão.</h2>
          <p>Conecte operação, relacionamento, recursos, finanças, suprimentos e governança. Entre em cada fluxo sem perder o contexto.</p>
          <div className="cisne-command-hero-actions">
            <EnterpriseButton type="button" appearance="primary" className="cisne-command-hero-main" onClick={() => navigate('Centro de operações')}>
              Entrar no centro de operações <ArrowRightRegular fontSize={18} aria-hidden="true" />
            </EnterpriseButton>
            <EnterpriseButton type="button" appearance="secondary" className="cisne-command-hero-secondary" onClick={onCreate}>
              <AddRegular fontSize={17} aria-hidden="true" /> Nova ordem de serviço
            </EnterpriseButton>
          </div>
        </div>
        <div className="cisne-command-hero-graphic" aria-label="Seis áreas de gestão integradas">
          <div className="cisne-command-graphic-ring" aria-hidden="true">
            <span className="cisne-command-orbit-a" /><span className="cisne-command-orbit-b" />
          </div>
          <div className="cisne-command-graphic-center">
            <GridRegular fontSize={32} aria-hidden="true" />
            <strong>06</strong><span>domínios conectados</span>
          </div>
          <span className="cisne-command-graphic-top">Ponta a ponta</span>
          <span className="cisne-command-graphic-bottom">26 áreas de trabalho</span>
        </div>
      </div>

      <div className="cisne-command-trust">
        <div><ShieldCheckmarkRegular fontSize={18} aria-hidden="true" /><span><strong>Dados protegidos por autorização</strong> · Cada indicador exige confirmação do servidor.</span></div>
        <span className="cisne-command-data-state" role="status">{isReady ? 'Indicadores autorizados' : dataState === 'loading' ? 'Consultando dados autorizados' : 'Indicadores indisponíveis'}</span>
      </div>
      {dataState !== 'ready' && <p role="status" className="enterprise-data-availability">
        {dataState === 'loading'
          ? 'Consultando indicadores operacionais autorizados…'
          : 'Indicadores indisponíveis. Não apresentar zero sem confirmação de dados autorizados.'}
      </p>}

      <div className="cisne-command-section-heading">
        <div><span className="cisne-command-eyebrow">PAINEL OPERACIONAL</span><h2>Indicadores da operação</h2><p>Agregados reais no contexto autorizado; clique para consultar a área correspondente.</p></div>
        <EnterpriseButton type="button" appearance="subtle" onClick={() => navigate('Ordens de serviço')}>
          Ver carteira <ArrowRightRegular fontSize={16} aria-hidden="true" />
        </EnterpriseButton>
      </div>
      <div className="enterprise-lanes cisne-command-metrics" aria-label="Indicadores operacionais">
        {metrics.map(({ label, value, Icon, explanation, onActivate, target }, index) => (
          <EnterpriseButton type="button" key={label} className="enterprise-lane cisne-command-metric" onClick={onActivate} aria-label={label + ': ' + (isReady ? String(value) : 'indisponível') + '. Abrir ' + target}>
            <span className="cisne-command-metric-top"><span className="cisne-command-metric-icon"><Icon fontSize={20} aria-hidden="true" /></span><span className="cisne-command-metric-index">0{index + 1}</span></span>
            <span className="cisne-command-metric-label">{label}</span>
            <strong className="cisne-command-metric-value">{dataState==='ready'?value:'—'}</strong>
            <span className="cisne-command-metric-cta">{explanation} <ArrowRightRegular fontSize={15} aria-hidden="true" /></span>
          </EnterpriseButton>
        ))}
      </div>

      <div className="cisne-command-section-heading">
        <div><span className="cisne-command-eyebrow">JORNADAS EMPRESARIAIS</span><h2>Trabalhe por processo, não por formulário</h2><p>Seis domínios com acesso direto a módulos funcionais do CISNE.</p></div>
        <span className="cisne-command-section-counter">06 domínios / 26 destinos</span>
      </div>
      <div className="cisne-command-domains" aria-label="Domínios empresariais">
        {journeys.map(({ code, title, subtitle, detail, target, Icon, tone }) => (
          <EnterpriseButton type="button" key={code}
            className={'cisne-command-domain cisne-command-domain-' + tone}
            onClick={() => navigate(target)}
            aria-label={'Abrir área ' + title + ' — jornada empresarial'}>
            <span className="cisne-command-domain-head"><span className="cisne-command-domain-icon"><Icon fontSize={24} aria-hidden="true" /></span><span className="cisne-command-domain-number">{code} / 06</span></span>
            <strong>{title}</strong><span className="cisne-command-domain-subtitle">{subtitle}</span>
            <span className="cisne-command-domain-description">{detail}</span>
            <span className="cisne-command-domain-action">Abrir área de trabalho <ArrowRightRegular fontSize={17} aria-hidden="true" /></span>
          </EnterpriseButton>
        ))}
      </div>

      <div className="cisne-command-board">
        <section className="enterprise-panel cisne-command-process" aria-label="Jornada operacional completa">
          <div className="cisne-command-board-title">
            <div><span className="cisne-command-eyebrow">PROCESSO INTEGRADO</span><h2>Do atendimento ao resultado</h2></div>
            <span className="cisne-command-board-caption"><CheckmarkCircleRegular fontSize={17} aria-hidden="true" /> Navegação funcional</span>
          </div>
          <div className="cisne-command-process-steps">
            {process.map(({ title, detail }, index) => (
              <EnterpriseButton type="button" key={title} onClick={() => navigate(title)}
                className="cisne-command-process-step" aria-label={'Abrir etapa ' + String(index + 1) + ': ' + title}>
                <span className="cisne-command-process-index">{String(index + 1).padStart(2, '0')}</span>
                <strong>{title}</strong><small>{detail}</small>
                <ChevronRightRegular fontSize={17} aria-hidden="true" />
              </EnterpriseButton>
            ))}
          </div>
        </section>
        <section className="enterprise-panel cisne-command-attention" aria-label="Acesso a prioridades reais">
          <div className="cisne-command-board-title">
            <div><span className="cisne-command-eyebrow">CENTRAL DE ATENÇÃO</span><h2>Prioridades e pendências</h2></div>
            <ShieldCheckmarkRegular fontSize={23} aria-hidden="true" />
          </div>
          <p>Sete filas empresariais com acesso condicionado ao servidor. A ausência de autorização não equivale à ausência de pendências.</p>
          <EnterpriseButton type="button" appearance="primary"
            aria-expanded={showPriorities} aria-controls="cisne-operational-exceptions"
            onClick={() => setShowPriorities(current => !current)}>
            {showPriorities ? 'Ocultar central de exceções' : 'Consultar central de exceções'}
            <OpenRegular fontSize={16} aria-hidden="true" />
          </EnterpriseButton>
        </section>
      </div>
      {showPriorities && <div id="cisne-operational-exceptions"><EnterpriseControlTower onLane={onControlTowerLane} onRecord={onControlTowerRecord} /></div>}

      <div className="cisne-command-bottom">
        <div className="cisne-command-total">
          <span className="cisne-command-total-count">{dataState==='ready'?summary.total:'—'}</span>
          <span>registros operacionais no contexto atual</span>
          <small>Indicadores condicionados às APIs autorizadas</small>
        </div>
        <div className="enterprise-operations-access">
          <div><strong>Centro de operações detalhado</strong><p>Consulte a fila e o contexto de cada ordem somente quando necessário.</p></div>
          <EnterpriseButton className="secondary" type="button" aria-expanded={showOperations}
            onClick={() => setShowOperations(current => !current)}>
            {showOperations ? 'Recolher detalhes' : 'Explorar ordens'} <ArrowRightRegular fontSize={16} aria-hidden="true" />
          </EnterpriseButton>
        </div>
      </div>
      {showOperations && <ServiceOperationsWorkspace onCreate={onCreate}
        onOpen={id => { if (id) onOpenOrder(id); else navigate('Ordens de serviço'); }} />}
    </section>
  );
}
