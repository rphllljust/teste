'use client';

import type { CSSProperties, HTMLAttributes, KeyboardEvent, ReactNode } from 'react';
import Link from 'next/link';

export type EnterpriseNavItem = { id: string; label: string; href?: string; icon?: ReactNode; active?: boolean; disabled?: boolean };
export type EnterpriseColumn<T> = { key: string; header: string; render: (row: T) => ReactNode; sortable?: boolean; headerLabel?: string; width?: string };
export type EnterpriseStatus = 'draft' | 'pending' | 'approved' | 'in_progress' | 'completed' | 'cancelled' | 'warning' | 'blocked';

const STATUS_LABELS: Record<EnterpriseStatus, string> = { draft: 'Rascunho', pending: 'Pendente', approved: 'Aprovado', in_progress: 'Em execução', completed: 'Concluído', cancelled: 'Cancelado', warning: 'Atenção', blocked: 'Bloqueado' };

export function EnterpriseAppShell({ children, brand = 'CISNE', context, company, navigation = [], topActions, userMenu, search, className = '' }: { children: ReactNode; brand?: ReactNode; context?: ReactNode; company?: ReactNode; navigation?: EnterpriseNavItem[]; topActions?: ReactNode; userMenu?: ReactNode; search?: ReactNode; className?: string }) {
  return <div className={`cisne-enterprise enterprise-app-shell ${className}`}>
    <header className="enterprise-topbar"><Link className="enterprise-brand" href="/" aria-label="CISNE — início">{brand}</Link><span className="enterprise-context">{context}</span><span className="enterprise-company">{company}</span><div className="enterprise-topbar-spacer" />{search && <div className="enterprise-global-search">{search}</div>}{topActions && <div className="enterprise-top-actions" aria-label="Ações globais">{topActions}</div>}{userMenu && <div className="enterprise-user-menu">{userMenu}</div>}</header>
    <aside className="enterprise-sidebar" aria-label="Navegação principal"><nav><ul>{navigation.map(item => <li key={item.id}><a className={item.active ? 'is-active' : ''} aria-current={item.active ? 'page' : undefined} aria-disabled={item.disabled || undefined} href={item.disabled ? undefined : item.href ?? '#'}>{item.icon}<span>{item.label}</span></a></li>)}</ul></nav></aside>
    <main className="enterprise-workspace">{children}</main>
  </div>;
}

export function EnterprisePageLayout({ children, breadcrumb, title, description, actions, className = '', ...props }: HTMLAttributes<HTMLElement> & { breadcrumb?: ReactNode; title?: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return <section className={`enterprise-page-layout ${className}`} {...props}>{breadcrumb && <nav className="enterprise-breadcrumb" aria-label="Navegação estrutural">{breadcrumb}</nav>}{(title || description || actions) && <header className="enterprise-page-header"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="enterprise-page-actions" aria-label="Ações da página">{actions}</div>}</header>}{children}</section>;
}

export function EnterpriseFilterBar({ children, label = 'Filtros', resultCount, onReset, onSubmit }: { children: ReactNode; label?: string; resultCount?: number; onReset?: () => void; onSubmit?: () => void }) {
  return <form className="enterprise-foundation-filter-bar" aria-label={label} onSubmit={event => { event.preventDefault(); onSubmit?.(); }}><div className="enterprise-filter-fields">{children}</div>{resultCount !== undefined && <span className="enterprise-result-count" aria-live="polite">{resultCount} resultado{resultCount === 1 ? '' : 's'}</span>}{onReset && <button type="button" className="enterprise-button enterprise-button-subtle" onClick={onReset}>Limpar filtros</button>}</form>;
}

export function EnterpriseActionBar({ children, primaryAction, label = 'Ações' }: { children?: ReactNode; primaryAction?: ReactNode; label?: string }) { return <div className="enterprise-action-bar" aria-label={label}><div className="enterprise-action-bar-primary">{primaryAction}</div><div className="enterprise-action-bar-secondary">{children}</div></div>; }

export function EnterpriseStatusBadge({ status, label }: { status: EnterpriseStatus; label?: string }) { return <span className={`enterprise-status-badge enterprise-status-${status}`} role="status">{label ?? STATUS_LABELS[status]}</span>; }

export function EnterpriseSectionNavigation({ sections, label = 'Seções' }: { sections: Array<{ id: string; label: string; count?: number }>; label?: string }) { return <nav className="enterprise-section-navigation" aria-label={label}>{sections.map(section => <a key={section.id} href={`#${section.id}`}>{section.label}{section.count !== undefined && <span aria-label={`${section.count} itens`}> {section.count}</span>}</a>)}</nav>; }

export function EnterpriseDataGrid<T>({ rows, columns, getRowKey, caption, loading = false, empty = 'Nenhum registro encontrado.', onRowClick, sort, onSort }: { rows: T[]; columns: Array<EnterpriseColumn<T>>; getRowKey: (row: T) => string | number; caption: string; loading?: boolean; empty?: ReactNode; onRowClick?: (row: T) => void; sort?: { key: string; direction: 'asc' | 'desc' }; onSort?: (key: string) => void }) {
  const activateRow = (event: KeyboardEvent<HTMLTableRowElement>, row: T) => { if (onRowClick && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onRowClick(row); } };
  return <div className="enterprise-foundation-grid" role="region" aria-label={caption} tabIndex={0}><table><caption className="enterprise-visually-hidden">{caption}</caption><thead><tr>{columns.map(column => <th key={column.key} scope="col" style={{ '--column-width': column.width } as CSSProperties} aria-sort={sort?.key === column.key ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}>{column.sortable && onSort ? <button type="button" className="enterprise-sort-button" onClick={() => onSort(column.key)}>{column.header}<span aria-hidden="true">{sort?.key === column.key ? sort.direction === 'asc' ? ' ↑' : ' ↓' : ''}</span><span className="enterprise-visually-hidden">Ordenar por {column.headerLabel ?? column.header}</span></button> : column.header}</th>)}</tr></thead><tbody>{loading ? <tr><td colSpan={columns.length} className="enterprise-grid-message" aria-busy="true">Carregando registros…</td></tr> : rows.length === 0 ? <tr><td colSpan={columns.length} className="enterprise-grid-message">{empty}</td></tr> : rows.map(row => <tr key={getRowKey(row)} tabIndex={onRowClick ? 0 : undefined} onClick={() => onRowClick?.(row)} onKeyDown={event => activateRow(event, row)}>{columns.map(column => <td key={column.key}>{column.render(row)}</td>)}</tr>)}</tbody></table></div>;
}
