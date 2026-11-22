'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRightRegular as ArrowRight, CheckmarkRegular as Check, ChevronDownRegular as ChevronDown, ChevronUpRegular as ChevronUp, ClockRegular as Clock3, AppsRegular as Grid2X2, TableRegular as LayoutList, SearchRegular as Search, SettingsRegular as SlidersHorizontal, StarRegular as Star } from '@fluentui/react-icons';
import { EnterpriseButton } from './EnterprisePrimitives';
import { enterpriseRelatedWorkspaces } from './EnterpriseWorkspaceContext';
import type { EnterpriseNavigationGroup } from './EnterpriseAppNavigation';

const FAVOURITES_KEY = 'cisne.enterprise.favourites.v1';
const RECENTS_KEY = 'cisne.enterprise.recents.v1';
const DENSITY_KEY = 'cisne.enterprise.density.v1';

const domainDescriptions: Record<string, string> = {
  'OPERAÇÃO': 'Acompanhe ordens, execução e medições com continuidade operacional.',
  'PLANEJAMENTO E RECURSOS': 'Planeje equipes, ativos e capacidade de atendimento.',
  'RELACIONAMENTO': 'Conduza clientes, propostas, oportunidades e contratos.',
  'FINANÇAS': 'Controle obrigações, recebimentos, caixa e tesouraria.',
  'SUPRIMENTOS': 'Conecte compras, materiais e necessidades da operação.',
  'FISCAL E CONTABILIDADE': 'Acompanhe documentos, escrituração e encerramentos.',
};
const domainLabels: Record<string, string> = {
  'OPERAÇÃO': 'Operações',
  'PLANEJAMENTO E RECURSOS': 'Planejamento',
  'RELACIONAMENTO': 'Relacionamento',
  'FINANÇAS': 'Finanças',
  'SUPRIMENTOS': 'Suprimentos',
  'FISCAL E CONTABILIDADE': 'Fiscal e contábil',
};
const journeys = [
  { title: 'Operar', detail: 'Ordens e execução', target: 'Centro de operações', domain: 'OPERAÇÃO' },
  { title: 'Vender', detail: 'Clientes e contratos', target: 'Clientes e propostas', domain: 'RELACIONAMENTO' },
  { title: 'Planejar', detail: 'Equipes e recursos', target: 'Resource Planning Board', domain: 'PLANEJAMENTO E RECURSOS' },
  { title: 'Controlar', detail: 'Finanças e caixa', target: 'Visão financeira', domain: 'FINANÇAS' },
  { title: 'Abastecer', detail: 'Compras e estoque', target: 'Estoque e compras', domain: 'SUPRIMENTOS' },
  { title: 'Escriturar', detail: 'Fiscal e contábil', target: 'Contabilidade', domain: 'FISCAL E CONTABILIDADE' },
] as const;

function readStoredNames(key: string, available: Set<string>): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? [...new Set(parsed.filter((name): name is string => typeof name === 'string' && available.has(name)))].slice(0, 10) : [];
  } catch {
    return [];
  }
}
function persist(key: string, value: string | string[]) {
  try { window.localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); }
  catch { /* Navigation still works when browser storage is disabled. */ }
}
type Props = {
  activePage: string;
  groups: EnterpriseNavigationGroup[];
  onNavigate: (name: string) => void;
  onSearch: () => void;
};
export function EnterpriseExperienceHub({ activePage, groups, onNavigate, onSearch }: Props) {
  const [ready, setReady] = useState(false);
  const [favourites, setFavourites] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [compact, setCompact] = useState(false);
  const [showDirectory, setShowDirectory] = useState(false);
  const [directoryQuery, setDirectoryQuery] = useState('');

  const allNames = useMemo(() => new Set(groups.flatMap(group => group.items.map(([name]) => name))), [groups]);
  const activeGroup = groups.find(group => group.items.some(([name]) => name === activePage));
  const sameGroup = (activeGroup?.items ?? []).map(([name]) => name).filter(name => name !== activePage).slice(0, 4);
  const related = (enterpriseRelatedWorkspaces[activePage] ?? []).filter(name => allNames.has(name));
  const favourite = favourites.includes(activePage);
  const filteredGroups = groups.map(group => ({
    group: group.group,
    items: group.items.filter(([name]) => name.toLocaleLowerCase('pt-BR').includes(directoryQuery.trim().toLocaleLowerCase('pt-BR'))),
  })).filter(group => group.items.length);

  useEffect(() => {
    setFavourites(readStoredNames(FAVOURITES_KEY, allNames));
    setRecent(readStoredNames(RECENTS_KEY, allNames));
    try { setCompact(window.localStorage.getItem(DENSITY_KEY) === 'compact'); } catch { /* no persisted preference */ }
    setReady(true);
  }, [allNames]);

  useEffect(() => {
    if (!ready || !allNames.has(activePage)) return;
    setRecent(previous => {
      const updated = [activePage, ...previous.filter(name => name !== activePage)].slice(0, 7);
      persist(RECENTS_KEY, updated);
      return updated;
    });
  }, [activePage, allNames, ready]);

  useEffect(() => {
    if (!ready) return;
    document.documentElement.setAttribute('data-cisne-density', compact ? 'compact' : 'comfortable');
    persist(DENSITY_KEY, compact ? 'compact' : 'comfortable');
  }, [compact, ready]);

  function toggleFavourite() {
    const next = favourite ? favourites.filter(name => name !== activePage) : [activePage, ...favourites].slice(0, 10);
    setFavourites(next);
    persist(FAVOURITES_KEY, next);
  }

  function openDirectory() {
    setShowDirectory(previous => !previous);
    setDirectoryQuery('');
  }

  return <section className="cisne-enterprise-hub" aria-label="Área de trabalho empresarial">
    <div className="cisne-enterprise-hub-banner">
      <div className="cisne-enterprise-hub-heading">
        <div className="cisne-enterprise-hub-eyebrow"><span className="cisne-enterprise-hub-beacon" aria-hidden="true" /> CISNE / ÁREA DE TRABALHO <span className="cisne-enterprise-hub-separator">/</span> {domainLabels[activeGroup?.group ?? ''] ?? 'Gestão integrada'}</div>
        <div className="cisne-enterprise-hub-title-row">
          <h2>{activePage}</h2>
          <span className="cisne-enterprise-hub-domain">{domainLabels[activeGroup?.group ?? ''] ?? 'Processo empresarial'}</span>
        </div>
        <p>{domainDescriptions[activeGroup?.group ?? ''] ?? 'Consulte os módulos e processos autorizados do CISNE.'}</p>
      </div>
      <div className="cisne-enterprise-hub-actions" aria-label="Comandos gerais da área de trabalho">
        <EnterpriseButton type="button" className="cisne-hub-command" appearance="subtle"
          onClick={toggleFavourite} aria-pressed={favourite} aria-label={favourite ? 'Remover ' + activePage + ' dos favoritos' : 'Adicionar ' + activePage + ' aos favoritos'}>
          <Star fontSize={16} fill={favourite ? 'currentColor' : 'none'} aria-hidden="true" /><span>{favourite ? 'Favorito' : 'Favoritar'}</span>
        </EnterpriseButton>
        <EnterpriseButton type="button" className="cisne-hub-command" appearance="subtle" onClick={() => setCompact(value => !value)}
          aria-pressed={compact} aria-label={compact ? 'Usar visualização confortável' : 'Usar visualização compacta'}>
          {compact ? <LayoutList fontSize={16} aria-hidden="true" /> : <SlidersHorizontal fontSize={16} aria-hidden="true" />}
          <span>{compact ? 'Confortável' : 'Compactar'}</span>
        </EnterpriseButton>
        <EnterpriseButton type="button" className="cisne-hub-command cisne-hub-command-primary" appearance="primary" onClick={onSearch}>
          <Search fontSize={16} aria-hidden="true" /><span>Pesquisar registros</span><kbd>Ctrl K</kbd>
        </EnterpriseButton>
      </div>
    </div>

    <div className="cisne-enterprise-hub-strip">
      <div className="cisne-enterprise-hub-strip-heading"><Grid2X2 fontSize={15} aria-hidden="true" /><span>Jornadas empresariais</span></div>
      <div className="cisne-enterprise-hub-journeys" role="group" aria-label="Acesso a jornadas empresariais">
        {journeys.filter(journey => allNames.has(journey.target)).map(journey => <EnterpriseButton
          key={journey.title} type="button" appearance="subtle"
          className={'cisne-enterprise-journey' + (journey.domain === activeGroup?.group ? ' is-domain-active' : '')}
          aria-label={'Abrir jornada ' + journey.title + ': ' + journey.target}
          onClick={() => onNavigate(journey.target)}>
          <strong>{journey.title}</strong><span>{journey.detail}</span><ArrowRight fontSize={14} aria-hidden="true" />
        </EnterpriseButton>)}
      </div>
    </div>

    <div className="cisne-enterprise-hub-footer">
      <div className="cisne-enterprise-hub-context" role="group" aria-label="Próximos módulos do fluxo">
        <span className="cisne-enterprise-hub-footer-label"><ArrowRight fontSize={14} aria-hidden="true" /> Continuar o processo</span>
        {(related.length ? related : sameGroup).slice(0, 3).map(name => <EnterpriseButton key={name}
          type="button" className="cisne-enterprise-hub-link" appearance="subtle"
          aria-label={'Continuar para ' + name} onClick={() => onNavigate(name)}>{name}<ArrowRight fontSize={13} aria-hidden="true" /></EnterpriseButton>)}
      </div>
      <EnterpriseButton type="button" className="cisne-hub-directory-toggle" appearance="subtle"
        aria-controls="cisne-enterprise-directory" aria-expanded={showDirectory} onClick={openDirectory}>
        <Grid2X2 fontSize={15} aria-hidden="true" /><span>{showDirectory ? 'Fechar catálogo' : 'Todos os módulos'}</span>
        {showDirectory ? <ChevronUp fontSize={15} aria-hidden="true" /> : <ChevronDown fontSize={15} aria-hidden="true" />}
      </EnterpriseButton>
    </div>
    {showDirectory && <div id="cisne-enterprise-directory" className="cisne-enterprise-directory">
      <div className="cisne-enterprise-directory-head">
        <div><h3>Catálogo de áreas de trabalho</h3><p>Acesso direto aos módulos existentes. Permissões e dados continuam controlados pelas APIs.</p></div>
        <label className="cisne-enterprise-directory-search">
          <Search fontSize={17} aria-hidden="true" /><span className="sr-only">Filtrar módulos</span>
          <input type="search" value={directoryQuery} onChange={event => setDirectoryQuery(event.target.value)}
            aria-label="Filtrar módulos" placeholder="Filtrar os 26 módulos…" />
        </label>
      </div>
      {ready && favourites.length > 0 && <section className="cisne-enterprise-directory-shortcuts" aria-label="Módulos favoritos">
        <h4><Star fontSize={14} aria-hidden="true" /> Favoritos</h4>
        <div>{favourites.map(name => <EnterpriseButton key={name} type="button" appearance="subtle"
          aria-label={'Abrir favorito ' + name} onClick={() => onNavigate(name)}>{name}<ArrowRight fontSize={12} aria-hidden="true" /></EnterpriseButton>)}</div>
      </section>}
      {ready && recent.length > 0 && <section className="cisne-enterprise-directory-shortcuts" aria-label="Módulos recentes">
        <h4><Clock3 fontSize={14} aria-hidden="true" /> Recentes</h4>
        <div>{recent.slice(0, 5).map(name => <EnterpriseButton key={name} type="button" appearance="subtle"
          aria-label={'Abrir recente ' + name} onClick={() => onNavigate(name)}>{name}<ArrowRight fontSize={12} aria-hidden="true" /></EnterpriseButton>)}</div>
      </section>}
      <div className="cisne-enterprise-directory-grid">
        {filteredGroups.map(group => <section key={group.group} className="cisne-enterprise-directory-domain">
          <h4>{domainLabels[group.group] ?? group.group} <span>{group.items.length}</span></h4>
          <div>{group.items.map(([name, Icon]) => <EnterpriseButton type="button" appearance="subtle" key={name}
            className={name === activePage ? 'is-current' : ''}
            aria-current={name === activePage ? 'page' : undefined}
            aria-label={'Abrir módulo ' + name} onClick={() => { onNavigate(name); setShowDirectory(false); }}>
            <Icon fontSize={17} aria-hidden="true" /><span>{name}</span>{name === activePage ? <Check fontSize={14} aria-hidden="true" /> : <ArrowRight fontSize={14} aria-hidden="true" />}
          </EnterpriseButton>)}</div>
        </section>)}
      </div>
      {filteredGroups.length === 0 && <p role="status" className="cisne-enterprise-directory-empty">Nenhum módulo corresponde ao filtro.</p>}
    </div>}
  </section>;
}
