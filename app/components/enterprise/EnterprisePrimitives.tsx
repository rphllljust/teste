'use client';

import type { ReactNode } from 'react';

export type EnterpriseStatus = 'draft' | 'pending' | 'approved' | 'in_progress' | 'completed' | 'cancelled' | 'warning' | 'blocked';

const labels: Record<EnterpriseStatus, string> = {
 draft: 'Rascunho', pending: 'Pendente', approved: 'Aprovado', in_progress: 'Em execução',
 completed: 'Concluído', cancelled: 'Cancelado', warning: 'Atenção', blocked: 'Bloqueado',
};

export function BusinessStatus({ status, label }: { status: EnterpriseStatus; label?: string }) {
 return <span className={`enterprise-status enterprise-status-${status}`} role="status">{label ?? labels[status]}</span>;
}

export function EnterprisePageHeader({ eyebrow, title, description, actions, breadcrumb }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode; breadcrumb?: string }) {
 return <header className="enterprise-page-header">{breadcrumb && <div className="enterprise-breadcrumb">{breadcrumb}</div>}<div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="enterprise-page-actions">{actions}</div>}</header>;
}

export function BusinessObjectHeader({ type, reference, title, status, facts, actions }: { type: string; reference?: string; title: string; status?: EnterpriseStatus; facts?: ReactNode; actions?: ReactNode }) {
 return <header className="business-object-header"><div><span className="eyebrow">{type}{reference ? ` · ${reference}` : ''}</span><h2>{title}</h2>{facts && <div className="business-object-facts">{facts}</div>}</div>{(status || actions) && <div className="business-object-actions">{status && <BusinessStatus status={status} />}{actions}</div>}</header>;
}

export function EnterpriseFilterBar({ children, onReset }: { children: ReactNode; onReset?: () => void }) {
 return <div className="enterprise-filter-bar">{children}{onReset && <button type="button" className="text-button" onClick={onReset}>Limpar filtros</button>}</div>;
}

export function WorkQueue({ children, label }: { children: ReactNode; label: string }) {
 return <section className="enterprise-work-queue" aria-label={label}>{children}</section>;
}


export function ObjectSection({title,eyebrow,children,actions}:{title:string;eyebrow?:string;children:ReactNode;actions?:ReactNode}){
 return <section className="enterprise-object-section"><header className="enterprise-object-section-header"><div>{eyebrow&&<span className="eyebrow">{eyebrow}</span>}<h3>{title}</h3></div>{actions&&<div className="enterprise-object-section-actions">{actions}</div>}</header>{children}</section>;
}

export function EmptyState({title,description,action}:{title:string;description?:string;action?:ReactNode}){
 return <div className="enterprise-empty-state" role="status"><h3>{title}</h3>{description&&<p>{description}</p>}{action}</div>;
}

export function LoadingState({label='Carregando dados…'}:{label?:string}){
 return <div className="enterprise-loading-state" role="status" aria-live="polite">{label}</div>;
}

export function ErrorState({message,onRetry}:{message:string;onRetry?:()=>void}){
 return <div className="enterprise-error-state" role="alert"><strong>Não foi possível concluir</strong><p>{message}</p>{onRetry&&<button className="secondary" onClick={onRetry}>Tentar novamente</button>}</div>;
}
