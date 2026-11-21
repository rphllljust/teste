'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import {
  Building2, ChevronDown, ChevronRight, Command, Layers, PanelLeft, Search,
} from 'lucide-react';
import { EnterpriseButton } from './EnterprisePrimitives';

export type EnterpriseNavigationGroup = {
  group: string;
  items: [string, LucideIcon][];
};

type SidebarProps = {
  groups: EnterpriseNavigationGroup[];
  activePage: string;
  open: boolean;
  ordersCount: number | null;
  onNavigate: (name: string) => void;
  onSearch: () => void;
};

export function EnterpriseSidebar({
  groups, activePage, open, ordersCount, onNavigate, onSearch,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  return (
    <aside className={'sidebar ' + (open ? 'mobile-open' : '')} aria-label="Navegação CISNE">
      <Link className="brand" href="/" aria-label="Cisne início">
        <span className="brand-mark"><Layers size={24} /></span>
        <span>CISNE<small>RONDÔNIA</small></span>
      </Link>
      <div className="company">
        <Building2 size={18} />
        <span>Gestão empresarial<small>Dados sob controle de acesso</small></span>
      </div>
      <nav aria-label="Módulos empresariais">
        {groups.map((group, index) => {
          const expanded = !collapsed[group.group];
          const groupId = 'cisne-nav-group-' + index;
          return (
            <div className="nav-group" key={group.group}>
              <EnterpriseButton
                type="button"
                appearance="transparent"
                className="nav-group-toggle"
                aria-expanded={expanded}
                aria-controls={groupId}
                onClick={() => setCollapsed(previous => ({
                  ...previous, [group.group]: !previous[group.group],
                }))}
              >
                <span>{group.group}</span>
                <ChevronDown size={14} aria-hidden="true" className={expanded ? '' : 'is-collapsed'} />
              </EnterpriseButton>
              <div id={groupId} hidden={!expanded} className="nav-group-items">
                {group.items.map(([name, Icon]) => (
                  <EnterpriseButton
                    type="button"
                    appearance="subtle"
                    key={name}
                    onClick={() => onNavigate(name)}
                    className={activePage === name ? 'active' : ''}
                    aria-current={activePage === name ? 'page' : undefined}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span>{name}</span>
                    {name === 'Ordens de serviço' && (
                      <span className="nav-count" aria-label={ordersCount === null ? 'Total indisponível' : String(ordersCount) + ' ordens'}>
                        {ordersCount === null ? '—' : ordersCount}
                      </span>
                    )}
                  </EnterpriseButton>
                ))}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="sidebar-bottom">
        <span className="version"><span />Cisne · Plataforma empresarial</span>
        <EnterpriseButton type="button" appearance="subtle" onClick={onSearch}>
          <Command size={17} aria-hidden="true" /> Navegação rápida <kbd>Ctrl K</kbd>
        </EnterpriseButton>
      </div>
    </aside>
  );
}

type TopbarProps = {
  activePage: string;
  group: string;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onSearch: () => void;
};

export function EnterpriseTopbar({
  activePage, group, sidebarOpen, onToggleSidebar, onSearch,
}: TopbarProps) {
  const groupLabels: Record<string, string> = {
    'OPERAÇÃO': 'Operação',
    'PLANEJAMENTO E RECURSOS': 'Planejamento e recursos',
    'RELACIONAMENTO': 'Relacionamento',
    'FINANÇAS': 'Finanças',
    'SUPRIMENTOS': 'Suprimentos',
    'FISCAL E CONTABILIDADE': 'Fiscal e contabilidade',
    'GESTÃO INTEGRADA': 'Gestão integrada',
  };
  const groupLabel = groupLabels[group] ?? group;
  return (
    <header className="topbar">
      <nav className="crumb" aria-label="Localização no CISNE">
        <EnterpriseButton
          type="button"
          appearance="transparent"
          className="mobile-toggle icon-button"
          aria-label={sidebarOpen ? 'Fechar menu' : 'Abrir menu'}
          aria-expanded={sidebarOpen}
          onClick={onToggleSidebar}
        >
          <PanelLeft size={20} />
        </EnterpriseButton>
        <span>CISNE</span><span className="crumb-divider">/</span>
        <span>{groupLabel}</span><ChevronRight size={14} aria-hidden="true" />
        <strong aria-current="page">{activePage}</strong>
      </nav>
      <div className="top-actions">
        <EnterpriseButton
          type="button"
          className="global-search"
          aria-label="Buscar no Cisne — Ctrl ou Command K"
          aria-keyshortcuts="Control+k Meta+k"
          onClick={onSearch}
        >
          <Search size={16} aria-hidden="true" />
          <span className="global-search-label">Buscar no Cisne</span>
          <kbd>Ctrl K</kbd>
        </EnterpriseButton>
        <span className="app-mode-pill"><span aria-hidden="true" />Workspace</span>
      </div>
    </header>
  );
}
