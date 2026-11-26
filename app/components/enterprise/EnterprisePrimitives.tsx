'use client';

import { Component, useEffect, useRef, useState, type ErrorInfo, type FormEvent, type HTMLAttributes, type Key, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';

export type EnterpriseStatus = 'draft'|'pending'|'approved'|'in_progress'|'completed'|'cancelled'|'warning'|'blocked';
const labels: Record<EnterpriseStatus, string> = { draft:'Rascunho', pending:'Pendente', approved:'Aprovado', in_progress:'Em execução', completed:'Concluído', cancelled:'Cancelado', warning:'Atenção', blocked:'Bloqueado' };
export function BusinessStatus({ status, label }: { status: EnterpriseStatus; label?: string }) { return <span className={`enterprise-status enterprise-status-${status}`} role="status">{label ?? labels[status]}</span>; }

export type EnterprisePageHeaderProps = { eyebrow?: string; title: string; description?: string; actions?: ReactNode; breadcrumb?: string|ReactNode; status?: ReactNode; id?: string };
export function EnterprisePageHeader({ eyebrow, title, description, actions, breadcrumb, status, id }: EnterprisePageHeaderProps) {
  const titleId = id ?? `enterprise-page-title-${title.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}`;
  return <header className="enterprise-page-header" aria-labelledby={titleId}><div className="enterprise-page-header-copy">{breadcrumb && <nav className="enterprise-breadcrumb" aria-label="Navegação estrutural">{breadcrumb}</nav>}{eyebrow && <span className="eyebrow">{eyebrow}</span>}<div className="enterprise-page-title-row"><h1 id={titleId}>{title}</h1>{status}</div>{description && <p>{description}</p>}</div>{actions && <div className="enterprise-page-actions" aria-label="Ações da página">{actions}</div>}</header>;
}

export type EnterpriseObjectHeaderProps = { type:string; reference?:string; title:string; status?:EnterpriseStatus; statusLabel?:string; facts?:ReactNode; actions?:ReactNode; description?:string };
export function BusinessObjectHeader({ type, reference, title, status, statusLabel, facts, actions, description }: EnterpriseObjectHeaderProps) { return <header className="business-object-header" aria-label={`${type}: ${title}`}><div className="business-object-heading"><span className="eyebrow">{type}{reference ? ` · ${reference}` : ''}</span><h2>{title}</h2>{description && <p className="enterprise-muted">{description}</p>}{facts && <div className="business-object-facts">{facts}</div>}</div>{(status || actions) && <div className="business-object-actions" aria-label="Ações do objeto">{status && <BusinessStatus status={status} label={statusLabel} />}{actions}</div>}</header>; }
export const EnterpriseObjectHeader = BusinessObjectHeader;

export type EnterpriseObjectSection = { id: string; label: string };
/** Scoped drawer anchors: active location follows the actual scroll region. */
export function EnterpriseObjectSectionNavigation({
  sections, label = 'Seções do documento', rootSelector = '.drawer',
}: { sections: readonly EnterpriseObjectSection[]; label?: string; rootSelector?: string }) {
  const navRef = useRef<HTMLElement>(null);
  const [active, setActive] = useState(sections[0]?.id ?? '');
  const ids = sections.map(section => section.id).join('|');

  useEffect(() => {
    const root = navRef.current?.closest(rootSelector) ?? navRef.current?.closest('.drawer');
    if (!root) return;
    // Keep document links scoped to their own drawer even when IDs repeat.
    const available = Array.from(root.querySelectorAll<HTMLElement>('[id]'));
    const targets = ids.split('|').map(id => available.find(element => element.id === id))
      .filter((element): element is HTMLElement => Boolean(element));
    if (!targets.length) return;
    setActive(targets[0].id);
    const syncActive = () => {
      const readingLine = root.getBoundingClientRect().top + 145;
      let current = targets[0];
      for (const target of targets) {
        if (target.getBoundingClientRect().top <= readingLine) current = target;
      }
      setActive(current.id);
    };
    root.addEventListener('scroll', syncActive, { passive: true });
    syncActive();
    if (typeof IntersectionObserver === 'undefined') {
      return () => root.removeEventListener('scroll', syncActive);
    }
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.id);
      else syncActive();
    }, { root, rootMargin: '-135px 0px -55% 0px', threshold: [0, 0.25, 0.5] });
    targets.forEach(target => observer.observe(target));
    return () => {
      observer.disconnect();
      root.removeEventListener('scroll', syncActive);
    };
  }, [ids,rootSelector]);

  const navigateToSection = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    const root = navRef.current?.closest(rootSelector) ?? navRef.current?.closest('.drawer');
    const target = Array.from(root?.querySelectorAll<HTMLElement>('[id]') ?? [])
      .find(element => element.id === id);
    if (!target) return;
    event.preventDefault(); // Do not change the host application's URL hash.
    if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
    target.scrollIntoView({ block: 'start', behavior: 'auto' });
    target.focus({ preventScroll: true });
    setActive(id);
  };

  const focusAdjacent = (event: KeyboardEvent<HTMLAnchorElement>, currentIndex: number) => {
    const count = sections.length;
    if (!count) return;
    let next = currentIndex;
    if (event.key === 'ArrowRight') next = (currentIndex + 1) % count;
    else if (event.key === 'ArrowLeft') next = (currentIndex - 1 + count) % count;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = count - 1;
    else return;
    event.preventDefault();
    navRef.current?.querySelectorAll<HTMLAnchorElement>('a')[next]?.focus();
  };

  return <nav ref={navRef} className="object-anchors" aria-label={label}>
    {sections.map((section, index) => <a
      key={section.id}
      href={'#' + section.id}
      aria-current={active === section.id ? 'location' : undefined}
      onClick={event => navigateToSection(event, section.id)}
      onKeyDown={event => focusAdjacent(event, index)}
    >{section.label}</a>)}
  </nav>;
}


export type EnterpriseObjectSummaryFact = { label: string; value: ReactNode };
export type EnterpriseObjectSummaryProps = {
  id?: string;
  type: string;
  reference?: string | null;
  title: string;
  subtitle?: string | null;
  status?: string | null;
  facts?: ReadonlyArray<EnterpriseObjectSummaryFact>;
};
/**
 * Consistent transaction header for commercial, operational and financial
 * object details. Facts are supplied from real object projections only.
 * Never infer a status or an amount from unrelated records.
 */
export function EnterpriseObjectSummary({
  id, type, reference, title, subtitle, status, facts = [],
}: EnterpriseObjectSummaryProps) {
  return <section id={id} className="enterprise-object-summary" aria-label={type + ': ' + title}>
    <span className="enterprise-object-summary-reference">{type}{reference ? ' · ' + reference : ''}</span>
    <div className="enterprise-object-summary-title">
      <h2>{title}</h2>
      {status && <span className="badge" role="status">{status}</span>}
    </div>
    {subtitle && <p>{subtitle}</p>}
    {facts.length > 0 && <dl className="enterprise-object-facts">
      {facts.map(fact => <div className="enterprise-object-fact" key={fact.label}>
        <dt>{fact.label}</dt><dd>{fact.value ?? '—'}</dd>
      </div>)}
    </dl>}
  </section>;
}


export type EnterpriseObjectPageProps = HTMLAttributes<HTMLElement> & { title:string; header:ReactNode; sections?:Array<{id:string;label:string}>; children:ReactNode };
export function EnterpriseObjectPage({ title, header, sections=[], children, className, ...props }: EnterpriseObjectPageProps) {
  const [activeSection, setActiveSection] = useState(sections[0]?.id ?? '');
  useEffect(() => {
    if (!sections.length) return;
    const targets = sections.map(section => document.getElementById(section.id)).filter(Boolean) as HTMLElement[];
    if (!targets.length) return;
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setActiveSection(visible.target.id);
    }, { rootMargin: '-18% 0px -68% 0px', threshold: [0, .25, .5, 1] });
    targets.forEach(target => observer.observe(target));
    return () => observer.disconnect();
  }, [sections]);
  return <main className={`enterprise-object-page${className ? ` ${className}` : ''}`} aria-label={title} {...props}>{header}{sections.length > 0 && <nav className="enterprise-object-tabs" aria-label="Seções do objeto">{sections.map(section => <a href={`#${section.id}`} key={section.id} aria-current={activeSection === section.id ? 'true' : undefined}>{section.label}</a>)}</nav>}<div className="enterprise-object-page-content">{children}</div></main>;
}

export function EnterpriseFilterBar({ children, onReset, label='Filtros', resultCount }: { children:ReactNode; onReset?:()=>void; label?:string; resultCount?:number }) { const reset = (event:FormEvent<HTMLFormElement>) => { event.preventDefault(); onReset?.(); }; return <form className="enterprise-filter-bar" aria-label={label} onSubmit={reset}><div className="enterprise-filter-fields">{children}</div>{typeof resultCount === 'number' && <span className="enterprise-filter-count" aria-live="polite">{resultCount} resultado{resultCount === 1 ? '' : 's'}</span>}{onReset && <button type="submit" className="text-button">Limpar filtros</button>}</form>; }

export type EnterpriseColumn<T> = { key:string; header:string; render:(row:T)=>ReactNode; sortable?:boolean; headerLabel?:string };
export type EnterpriseDataGridProps<T> = { rows:T[]; columns:EnterpriseColumn<T>[]; getRowKey:(row:T)=>Key; caption:string; empty?:ReactNode; loading?:boolean; onRowClick?:(row:T)=>void; sort?:{key:string;direction:'asc'|'desc'}; onSort?:(key:string)=>void };
export function EnterpriseDataGrid<T>({ rows, columns, getRowKey, caption, empty='Nenhum registro encontrado.', loading, onRowClick, sort, onSort }:EnterpriseDataGridProps<T>) { return <div className="enterprise-data-grid" role="region" aria-label={caption} tabIndex={0}><table><caption className="sr-only">{caption}</caption><thead><tr>{columns.map(column => <th scope="col" key={column.key} aria-sort={sort?.key === column.key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>{column.sortable && onSort ? <button type="button" className="enterprise-sort-button" onClick={() => onSort(column.key)} aria-label={`Ordenar por ${column.headerLabel ?? column.header}`}>{column.header}{sort?.key === column.key ? <span aria-hidden="true"> {sort.direction === 'asc' ? '↑' : '↓'}</span> : null}</button> : column.header}</th>)}</tr></thead><tbody>{loading ? <tr><td colSpan={columns.length}><LoadingState label="Carregando registros…" /></td></tr> : rows.length === 0 ? <tr><td colSpan={columns.length}><EmptyState title={typeof empty === 'string' ? empty : 'Nenhum registro'}>{typeof empty === 'string' ? undefined : empty}</EmptyState></td></tr> : rows.map(row => <tr key={getRowKey(row)} tabIndex={onRowClick ? 0 : undefined} onClick={() => onRowClick?.(row)} onKeyDown={event => { if (onRowClick && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onRowClick(row); } }}>{columns.map(column => <td key={column.key}>{column.render(row)}</td>)}</tr>)}</tbody></table></div>; }

export type EnterpriseWorklistProps = { label:string; title?:string; count?:number; children:ReactNode; filters?:ReactNode; actions?:ReactNode };
export function EnterpriseWorklist({ label, title, count, children, filters, actions }:EnterpriseWorklistProps) { return <section className="enterprise-work-queue enterprise-worklist" aria-label={label}><div className="enterprise-worklist-header"><div><h2>{title ?? label}</h2>{typeof count === 'number' && <span aria-label={`${count} itens`}>{count} itens</span>}</div>{actions && <div className="enterprise-worklist-actions">{actions}</div>}</div>{filters && <div className="enterprise-worklist-filters">{filters}</div>}<div className="enterprise-worklist-content">{children}</div></section>; }
export const WorkQueue = EnterpriseWorklist;

export type EnterpriseKpiCardProps = { label:string; value:ReactNode; trend?:ReactNode; description?:string; icon?:ReactNode; onClick?:()=>void; tone?:'neutral'|'positive'|'warning'|'negative' };
export function EnterpriseKpiCard({ label, value, trend, description, icon, onClick, tone='neutral' }:EnterpriseKpiCardProps) { const content = <><span className="enterprise-kpi-label">{label}{icon && <span aria-hidden="true">{icon}</span>}</span><strong>{value}</strong>{trend && <span className={`enterprise-kpi-trend ${tone}`}>{trend}</span>}{description && <small>{description}</small>}</>; return onClick ? <button type="button" className="enterprise-kpi-card" onClick={onClick} aria-label={`${label}: ${value}`}>{content}</button> : <section className="enterprise-kpi-card" aria-label={label}>{content}</section>; }

export type AnalyticalDatum = { label:string; value:number; description?:string; tone?:'neutral'|'positive'|'warning'|'negative' };
export function EnterpriseAnalyticalChart({ title, data, onSelect, valueLabel='valor' }:{ title:string; data:AnalyticalDatum[]; onSelect?:(datum:AnalyticalDatum)=>void; valueLabel?:string }) { const max = Math.max(...data.map(item => item.value), 1); return <section className="enterprise-analytical-chart" aria-label={title}><div className="enterprise-analytical-heading"><h2>{title}</h2><span>{valueLabel}</span></div><div className="enterprise-analytical-bars" role="list">{data.map(item => { const bar = <span className={`enterprise-analytical-bar ${item.tone ?? 'neutral'}`} style={{ width:`${Math.max((item.value/max)*100, item.value ? 4 : 0)}%` }} aria-hidden="true" />; return <div className="enterprise-analytical-row" role="listitem" key={item.label}>{onSelect ? <button type="button" onClick={() => onSelect(item)} aria-label={`${item.label}: ${item.value} ${valueLabel}`}>{bar}<span>{item.label}</span><strong>{item.value}</strong></button> : <div>{bar}<span>{item.label}</span><strong>{item.value}</strong></div>}</div>; })}</div></section>; }

export function ObjectSection({ title, eyebrow, children, actions, id }:{title:string;eyebrow?:string;children:ReactNode;actions?:ReactNode;id?:string}) { return <section className="enterprise-object-section" id={id} aria-labelledby={id ? `${id}-title` : undefined}><header className="enterprise-object-section-header"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h3 id={id ? `${id}-title` : undefined}>{title}</h3></div>{actions && <div className="enterprise-object-section-actions">{actions}</div>}</header>{children}</section>; }
export function EmptyState({ title, description, action, children }:{title:string;description?:string;action?:ReactNode;children?:ReactNode}) { return <div className="enterprise-empty-state" role="status"><h3>{title}</h3>{description && <p>{description}</p>}{children}{action}</div>; }
export function LoadingState({ label='Carregando dados…' }:{label?:string}) { return <div className="enterprise-loading-state" role="status" aria-live="polite" aria-busy="true">{label}</div>; }
export type EnterpriseDataStateKind = 'error'|'blocked'|'manual'|'not_configured'|'unavailable';
const enterpriseDataStateLabels: Record<EnterpriseDataStateKind, string> = {
  error: 'Erro ao carregar',
  blocked: 'Bloqueado por dependência',
  manual: 'Processo manual',
  not_configured: 'Não configurado',
  unavailable: 'Indisponível',
};
export function classifyEnterpriseDataState(message: string): EnterpriseDataStateKind {
  const value = message.toLowerCase();
  if (/não configurad|nao configurad|ofbiz|sefaz|prefeitura|credencial|dependência|dependencia/.test(value)) return 'not_configured';
  if (/bloquead|não homologável|nao homologavel|não suportad|nao suportad|permissão|permissao|403/.test(value)) return 'blocked';
  if (/manual|não transmitid|nao transmitid|aguardando transmissão|aguardando transmissao/.test(value)) return 'manual';
  if (/indisponív|indisponiv|timeout|temporariamente|503|sem resposta/.test(value)) return 'unavailable';
  return 'error';
}
export function EnterpriseDataState({ kind, title, message, action }: { kind: EnterpriseDataStateKind; title?: string; message: string; action?: ReactNode }) {
  return <section className={`enterprise-data-state enterprise-data-state-${kind}`} data-state-kind={kind} role={kind === 'error' ? 'alert' : 'status'} aria-live="polite">
    <span className="enterprise-data-state-label">{enterpriseDataStateLabels[kind]}</span>
    <strong>{title ?? enterpriseDataStateLabels[kind]}</strong>
    <p>{message}</p>
    {action}
  </section>;
}
export function ErrorState({ message, onRetry, kind }:{message:string;onRetry?:()=>void;kind?:EnterpriseDataStateKind}) {
  const resolvedKind = kind ?? classifyEnterpriseDataState(message);
  return <EnterpriseDataState kind={resolvedKind} message={message} action={onRetry && <button type="button" className="secondary" onClick={onRetry}>Tentar novamente</button>} />;
}

type ErrorBoundaryProps = { children:ReactNode; fallback?:ReactNode; onError?:(error:Error, info:ErrorInfo)=>void };
type ErrorBoundaryState = { error:Error|null };
export class EnterpriseErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> { state:ErrorBoundaryState = { error:null }; static getDerivedStateFromError(error:Error):ErrorBoundaryState { return { error }; } componentDidCatch(error:Error, info:ErrorInfo) { this.props.onError?.(error, info); } reset = (event?:MouseEvent<HTMLButtonElement>) => { event?.preventDefault(); this.setState({ error:null }); }; render() { if (!this.state.error) return this.props.children; return this.props.fallback ?? <ErrorState message="Ocorreu um erro inesperado nesta área." onRetry={this.reset} />; } }
export function EnterpriseErrorFallback({ title='Área indisponível', description, onRetry }:{title?:string;description?:string;onRetry?:()=>void}) { return <div className="enterprise-error-state" role="alert"><strong>{title}</strong><p>{description ?? 'Não foi possível carregar este conteúdo.'}</p>{onRetry && <button type="button" className="secondary" onClick={onRetry}>Tentar novamente</button>}</div>; }
