'use client';

import { Component, useEffect, useState, type ErrorInfo, type FormEvent, type HTMLAttributes, type Key, type MouseEvent, type ReactNode } from 'react';

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
  error: 'Erro de carregamento',
  blocked: 'Operação bloqueada',
  manual: 'Processo manual',
  not_configured: 'Não configurado',
  unavailable: 'Indisponível',
};
export function EnterpriseDataState({ kind, title, description, action, onRetry }: { kind: EnterpriseDataStateKind; title?: string; description: string; action?: ReactNode; onRetry?: () => void }) {
  return <section className={`enterprise-data-state enterprise-data-state-${kind}`} role={kind === 'error' ? 'alert' : 'status'} aria-live="polite">
    <span className="enterprise-data-state-label">{enterpriseDataStateLabels[kind]}</span>
    <h3>{title ?? enterpriseDataStateLabels[kind]}</h3>
    <p>{description}</p>
    <div className="enterprise-data-state-actions">{action}{onRetry && <button type="button" className="secondary" onClick={onRetry}>Tentar novamente</button>}</div>
  </section>;
}

export function ErrorState({ message, onRetry }:{message:string;onRetry?:()=>void}) { return <div className="enterprise-error-state" role="alert"><strong>Não foi possível concluir</strong><p>{message}</p>{onRetry && <button type="button" className="secondary" onClick={onRetry}>Tentar novamente</button>}</div>; }

type ErrorBoundaryProps = { children:ReactNode; fallback?:ReactNode; onError?:(error:Error, info:ErrorInfo)=>void };
type ErrorBoundaryState = { error:Error|null };
export class EnterpriseErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> { state:ErrorBoundaryState = { error:null }; static getDerivedStateFromError(error:Error):ErrorBoundaryState { return { error }; } componentDidCatch(error:Error, info:ErrorInfo) { this.props.onError?.(error, info); } reset = (event?:MouseEvent<HTMLButtonElement>) => { event?.preventDefault(); this.setState({ error:null }); }; render() { if (!this.state.error) return this.props.children; return this.props.fallback ?? <ErrorState message="Ocorreu um erro inesperado nesta área." onRetry={this.reset} />; } }
export function EnterpriseErrorFallback({ title='Área indisponível', description, onRetry }:{title?:string;description?:string;onRetry?:()=>void}) { return <div className="enterprise-error-state" role="alert"><strong>{title}</strong><p>{description ?? 'Não foi possível carregar este conteúdo.'}</p>{onRetry && <button type="button" className="secondary" onClick={onRetry}>Tentar novamente</button>}</div>; }
