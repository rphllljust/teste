'use client';

import { Children, isValidElement, useEffect, useId, useRef, useState, Component, type ErrorInfo, type FormEvent, type HTMLAttributes, type Key, type MouseEvent, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { resolveActiveSectionId } from '../../../lib/ui/enterprise-sections';
import { Button as FluentButton, Checkbox as FluentCheckbox, DataGrid as FluentDataGrid, DataGridBody, DataGridCell, DataGridHeader, DataGridHeaderCell, DataGridRow, Dialog as FluentDialog, DialogSurface, Dropdown as FluentDropdown, Field as FluentField, Input as FluentInput, MessageBar as FluentMessageBar, MessageBarBody, MessageBarTitle, Option as FluentOption, Spinner as FluentSpinner, Tab as FluentTab, TabList as FluentTabList, Textarea as FluentTextarea, createTableColumn, type ButtonProps, type TableColumnDefinition } from '@fluentui/react-components';
import { SearchRegular } from '@fluentui/react-icons';

export const EnterpriseInput = FluentInput;
export const EnterpriseTextarea = FluentTextarea;
export const EnterpriseCheckbox = FluentCheckbox;

export function EnterpriseDialog({ open, ariaLabel, onDismiss, children }: { open:boolean; ariaLabel:string; onDismiss:()=>void; children:ReactNode }) {
 return <FluentDialog open={open} modalType="modal" onOpenChange={(_,data)=>{if(!data.open)onDismiss();}}><DialogSurface aria-label={ariaLabel}>{children}</DialogSurface></FluentDialog>;
}

export function EnterpriseButton({ appearance, className, ...props }: ButtonProps) {
 const resolvedAppearance = appearance ?? (className?.split(' ').includes('primary') ? 'primary' : 'secondary');
 return <FluentButton appearance={resolvedAppearance} className={className} {...props} />;
}

export function EnterpriseSearchField({ label, value, placeholder, onValueChange, className='search-input', disabled }: { label:string; value:string; placeholder:string; onValueChange:(value:string)=>void; className?:string; disabled?:boolean }) {
 return <FluentField label={label} className={className}><FluentInput type="search" aria-label={label} contentBefore={<SearchRegular aria-hidden="true" />} value={value} placeholder={placeholder} disabled={disabled} onChange={event=>onValueChange(event.currentTarget.value)} /></FluentField>;
}

export function EnterpriseSelectField({ label, value, options, onValueChange, className }: { label:string; value:string; options:Array<{value:string;label:string}>; onValueChange:(value:string)=>void; className?:string }) {
 const selected=options.find(option=>option.value===value);
 return <FluentField label={label} className={className}><FluentDropdown aria-label={label} value={selected?.label??options[0]?.label??''} selectedOptions={selected&&value!==''?[value]:[]} onOptionSelect={(_,data)=>onValueChange(String(data.optionValue??''))}>{options.map(option=><FluentOption key={option.value||'__empty'} value={option.value}>{option.label}</FluentOption>)}</FluentDropdown></FluentField>;
}

type EnterpriseDropdownOption = ReactElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>;

function dropdownOptionText(node: ReactNode): string {
 return Children.toArray(node).map(item => {
  if (typeof item === 'string' || typeof item === 'number') return String(item);
  return isValidElement<{ children?: ReactNode }>(item) ? dropdownOptionText(item.props.children) : '';
 }).join('');
}

/**
 * Fluent Dropdown accepts selected values, not native ChangeEvents.
 * Consumers receive a value callback; uncontrolled selects retain their own selection.
 * Required transactional selects remain native until constraint-validation parity is proven.
 */
export function EnterpriseDropdown({ children, value, defaultValue, onValueChange, className, name, disabled, required, ...props }: { children: ReactNode; value?: string | number; defaultValue?: string | number; onValueChange?: (value: string) => void; className?: string; name?: string; disabled?: boolean; required?: boolean; 'aria-label'?: string; id?: string; title?: string; 'aria-describedby'?: string }) {
 const options = Children.toArray(children).filter(isValidElement) as EnterpriseDropdownOption[];
 const [uncontrolledValue, setUncontrolledValue] = useState<string | null>(null);
 const optionValue = (option: EnterpriseDropdownOption) => String(option.props.value ?? dropdownOptionText(option.props.children));
 const selectedValue = value !== undefined ? String(value) : (uncontrolledValue ?? String(defaultValue ?? (options[0] ? optionValue(options[0]) : '')));
 const selected = options.find(option => optionValue(option) === selectedValue);
 const display = selected ? dropdownOptionText(selected.props.children) : '';
 return <div className={className}><FluentDropdown {...props} aria-required={required || undefined} disabled={disabled} value={display} selectedOptions={selectedValue ? [selectedValue] : []} onOptionSelect={(_, data) => {
  const next = String(data.optionValue ?? '');
  if (value === undefined) setUncontrolledValue(next);
  onValueChange?.(next);
 }}>{options.map((option, index) => <FluentOption key={option.key ?? `${optionValue(option)}-${index}`} text={dropdownOptionText(option.props.children)} value={optionValue(option)} disabled={option.props.disabled}>{option.props.children}</FluentOption>)}</FluentDropdown>{name && <input type="hidden" name={name} value={selectedValue} disabled={disabled} />}</div>;
}

export type EnterpriseStatus = 'draft'|'pending'|'approved'|'in_progress'|'completed'|'cancelled'|'warning'|'blocked';
const labels: Record<EnterpriseStatus, string> = { draft:'Rascunho', pending:'Pendente', approved:'Aprovado', in_progress:'Em execução', completed:'Concluído', cancelled:'Cancelado', warning:'Atenção', blocked:'Bloqueado' };
export function BusinessStatus({ status, label }: { status: EnterpriseStatus; label?: string }) { return <span className={`enterprise-status enterprise-status-${status}`} role="status">{label ?? labels[status]}</span>; }

export type EnterprisePageHeaderProps = { eyebrow?: string; title: string; description?: string; actions?: ReactNode; breadcrumb?: string|ReactNode; status?: ReactNode; id?: string };
export function EnterprisePageHeader({ eyebrow, title, description, actions, breadcrumb, status, id }: EnterprisePageHeaderProps) {
  const titleId = id ?? `enterprise-page-title-${title.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}`;
  return <div className="enterprise-page-frame"><header className="enterprise-page-header" aria-labelledby={titleId}><div className="enterprise-page-header-copy">{breadcrumb && <nav className="enterprise-breadcrumb" aria-label="Navegação estrutural">{breadcrumb}</nav>}{eyebrow && <span className="eyebrow">{eyebrow}</span>}<div className="enterprise-page-title-row"><h1 id={titleId}>{title}</h1>{status}</div>{description && <p>{description}</p>}</div></header>{actions && <div className="enterprise-command-bar command-bar" role="toolbar" aria-label={`Ações de ${title}`}>{actions}</div>}</div>;
}

export type EnterpriseObjectHeaderProps = { type:string; reference?:string; title:string; status?:EnterpriseStatus; statusLabel?:string; facts?:ReactNode; actions?:ReactNode; description?:string };
export function BusinessObjectHeader({ type, reference, title, status, statusLabel, facts, actions, description }: EnterpriseObjectHeaderProps) { return <header className="business-object-header" aria-label={`${type}: ${title}`}><div className="business-object-heading"><span className="eyebrow">{type}{reference ? ` · ${reference}` : ''}</span><h2>{title}</h2>{description && <p className="enterprise-muted">{description}</p>}{facts && <div className="business-object-facts">{facts}</div>}</div>{(status || actions) && <div className="business-object-actions" aria-label="Ações do objeto">{status && <BusinessStatus status={status} label={statusLabel} />}{actions}</div>}</header>; }
export const EnterpriseObjectHeader = BusinessObjectHeader;

export type EnterpriseObjectPageProps = HTMLAttributes<HTMLElement> & { title:string; header:ReactNode; sections?:Array<{id:string;label:string}>; children:ReactNode };
export function EnterpriseObjectPage({ title, header, sections=[], children, className, ...props }: EnterpriseObjectPageProps) {
 const [activeSection,setActiveSection]=useState(sections[0]?.id??'');
 const [navigationOpen,setNavigationOpen]=useState(false);
 const sectionNavigationId=useId();
 const explicitSectionRef=useRef<string|null>(null);
 const sectionSignature=sections.map(section=>section.id).join('\u0000');
 const activeSectionId=resolveActiveSectionId(sections,activeSection);
 useEffect(()=>{
  if(!sectionSignature||typeof IntersectionObserver==='undefined')return;
  const observer=new IntersectionObserver(entries=>{
   const requested=explicitSectionRef.current;
   if(requested){
     if(entries.some(entry=>entry.target.id===requested&&entry.isIntersecting)){
       explicitSectionRef.current=null;
       setActiveSection(current=>current===requested?current:requested);
     }
     return;
   }
   const next=entries.filter(entry=>entry.isIntersecting).sort((a,b)=>a.boundingClientRect.top-b.boundingClientRect.top)[0]?.target.id;
   if(next)setActiveSection(current=>current===next?current:next);
  },{rootMargin:'-84px 0px -65% 0px',threshold:[0,0.1,0.5]});
  for(const id of sectionSignature.split('\u0000')){
   const section=document.getElementById(id);
   if(section)observer.observe(section);
  }
  return()=>observer.disconnect();
 },[sectionSignature]);
 return <section role="region" className={`enterprise-object-page enterprise-object-page-v2${className ? ` ${className}` : ''}`} aria-label={title} {...props}>
  <div className="enterprise-object-identity">{header}</div>
  {sections.length>1&&<div className="enterprise-object-nav-wrap"><EnterpriseButton type="button" className="enterprise-object-nav-toggle" aria-expanded={navigationOpen} aria-controls={sectionNavigationId} onClick={()=>setNavigationOpen(v=>!v)}>Seções do registro · {sections.find(s=>s.id===activeSectionId)?.label??'Visão geral'}</EnterpriseButton><nav id={sectionNavigationId} className={`enterprise-object-tabs ${navigationOpen?'is-open':''}`} aria-label="Seções do objeto">{sections.map(section=><a key={section.id} href={'#'+section.id} aria-current={section.id===activeSectionId?'location':undefined} onClick={()=>{explicitSectionRef.current=section.id;setActiveSection(section.id);setNavigationOpen(false);}}>{section.label}</a>)}</nav></div>}
  <div className="enterprise-object-page-content">{children}</div>
 </section>;
}

export function EnterpriseFilterBar({ children, onReset, label='Filtros', resultCount }: { children:ReactNode; onReset?:()=>void; label?:string; resultCount?:number }) { const reset = (event:FormEvent<HTMLFormElement>) => { event.preventDefault(); onReset?.(); }; return <form className="enterprise-filter-bar" aria-label={label} onSubmit={reset}><div className="enterprise-filter-fields">{children}</div>{typeof resultCount === 'number' && <span className="enterprise-filter-count" aria-live="polite">{resultCount} resultado{resultCount === 1 ? '' : 's'}</span>}{onReset && <EnterpriseButton type="submit" appearance="subtle" className="text-button">Limpar filtros</EnterpriseButton>}</form>; }

export type EnterpriseColumn<T> = { key:string; header:string; render:(row:T)=>ReactNode; sortable?:boolean; sortValue?:(row:T)=>string|number; headerLabel?:string };
export type EnterpriseDataGridProps<T> = { rows:T[]; columns:EnterpriseColumn<T>[]; getRowKey:(row:T)=>Key; caption:string; empty?:ReactNode; loading?:boolean; onRowClick?:(row:T)=>void; sort?:{key:string;direction:'asc'|'desc'}; onSort?:(key:string)=>void };
export function EnterpriseDataGrid<T>({ rows, columns, getRowKey, caption, empty='Nenhum registro encontrado.', loading, onRowClick, sort, onSort }:EnterpriseDataGridProps<T>) {
 const fluentColumns:TableColumnDefinition<T>[] = columns.map(column=>createTableColumn<T>({
   columnId:column.key,
   compare:column.sortValue?(a,b)=>{
     const left=column.sortValue!(a),right=column.sortValue!(b);
     return typeof left==='number'&&typeof right==='number'
       ?left-right:String(left).localeCompare(String(right),'pt-BR',{numeric:true,sensitivity:'base'});
   }:undefined,
   renderHeaderCell:()=>column.header,
   renderCell:row=>column.render(row),
 }));
 const sortable=columns.filter(column=>column.sortable&&onSort);
 return <div className="enterprise-data-grid" role="region" aria-label={caption} tabIndex={0}>
   {loading?<LoadingState label="Carregando registros…"/>:rows.length===0?
     <EmptyState title={typeof empty==='string'?empty:'Nenhum registro'}>
       {typeof empty==='string'?undefined:empty}
     </EmptyState>:
     <>
       <FluentDataGrid
         className="enterprise-desktop-grid"
         aria-label={caption}
         items={rows}
         columns={fluentColumns}
         getRowId={row=>String(getRowKey(row))}
         sortable={columns.some(column=>column.sortable&&column.sortValue)}
         sortState={sort?{sortColumn:sort.key,sortDirection:sort.direction==='asc'?'ascending':'descending'}:undefined}
         onSortChange={(_,next)=>{if(next.sortColumn)onSort?.(String(next.sortColumn));}}
       >
         <DataGridHeader>
           <DataGridRow>{({renderHeaderCell})=><DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>}</DataGridRow>
         </DataGridHeader>
         <DataGridBody<T>>
           {({item,rowId})=><DataGridRow<T> key={rowId} tabIndex={onRowClick?0:undefined} aria-label={onRowClick?`Abrir registro ${String(getRowKey(item))}`:undefined} onClick={(event:MouseEvent<HTMLDivElement>)=>{if(!onRowClick)return;const target=event.target;if(target instanceof Element&&target.closest('a,button,input,select,textarea,[role="button"],[role="link"]'))return;onRowClick(item);}} onKeyDown={(event:KeyboardEvent<HTMLDivElement>)=>{if(!onRowClick||event.target!==event.currentTarget)return;if(event.key==='Enter'||event.key===' '){event.preventDefault();onRowClick(item);}}}>
             {({renderCell})=><DataGridCell>{renderCell(item)}</DataGridCell>}
           </DataGridRow>}
         </DataGridBody>
       </FluentDataGrid>
       <div className="enterprise-mobile-report">
         {sortable.length>0&&<div className="enterprise-mobile-report-sort" aria-label="Ordenação de registros">
           {sortable.map(column=><EnterpriseButton type="button" key={column.key} appearance="subtle" onClick={()=>onSort?.(column.key)}>
             Ordenar por {column.headerLabel??column.header}
           </EnterpriseButton>)}
         </div>}
         <ul className="enterprise-mobile-records" aria-label={caption+' — versão compacta'}>
           {rows.map(row=><li className="enterprise-mobile-record" key={getRowKey(row)}>
             <dl>{columns.map(column=><div className="enterprise-mobile-record-field" key={column.key}>
               <dt>{column.headerLabel??column.header}</dt>
               <dd>{column.render(row)}</dd>
             </div>)}</dl>
             {onRowClick&&<EnterpriseButton type="button" appearance="subtle" className="enterprise-mobile-record-open" onClick={()=>onRowClick(row)}>
               Abrir registro
             </EnterpriseButton>}
           </li>)}
         </ul>
       </div>
     </>}
 </div>;
}

export type EnterpriseWorklistProps = { label:string; title?:string; count?:number; children:ReactNode; filters?:ReactNode; actions?:ReactNode };
export function EnterpriseWorklist({ label, title, count, children, filters, actions }:EnterpriseWorklistProps) { return <section className="enterprise-work-queue enterprise-worklist" aria-label={label}><div className="enterprise-worklist-header"><div><h2>{title ?? label}</h2>{typeof count === 'number' && <span aria-label={`${count} itens`}>{count} itens</span>}</div>{actions && <div className="enterprise-worklist-actions">{actions}</div>}</div>{filters && <div className="enterprise-worklist-filters">{filters}</div>}<div className="enterprise-worklist-content">{children}</div></section>; }
export const WorkQueue = EnterpriseWorklist;

export type EnterpriseKpiCardProps = { label:string; value:ReactNode; trend?:ReactNode; description?:string; icon?:ReactNode; onClick?:()=>void; tone?:'neutral'|'positive'|'warning'|'negative' };
export function EnterpriseKpiCard({ label, value, trend, description, icon, onClick, tone='neutral' }:EnterpriseKpiCardProps) { const content = <><span className="enterprise-kpi-label">{label}{icon && <span aria-hidden="true">{icon}</span>}</span><strong>{value}</strong>{trend && <span className={`enterprise-kpi-trend ${tone}`}>{trend}</span>}{description && <small>{description}</small>}</>; return onClick ? <FluentButton type="button" appearance="subtle" className="enterprise-kpi-card" onClick={onClick} aria-label={`${label}: ${value}`}>{content}</FluentButton> : <section className="enterprise-kpi-card" aria-label={label}>{content}</section>; }

export type AnalyticalDatum = { label:string; value:number; description?:string; tone?:'neutral'|'positive'|'warning'|'negative' };
export function EnterpriseAnalyticalChart({ title, data, onSelect, valueLabel='valor' }:{ title:string; data:AnalyticalDatum[]; onSelect?:(datum:AnalyticalDatum)=>void; valueLabel?:string }) { const max = Math.max(...data.map(item => item.value), 1); return <section className="enterprise-analytical-chart" aria-label={title}><div className="enterprise-analytical-heading"><h2>{title}</h2><span>{valueLabel}</span></div><div className="enterprise-analytical-bars" role="list">{data.map(item => { const bar = <span className={`enterprise-analytical-bar ${item.tone ?? 'neutral'}`} style={{ width:`${Math.max((item.value/max)*100, item.value ? 4 : 0)}%` }} aria-hidden="true" />; return <div className="enterprise-analytical-row" role="listitem" key={item.label}>{onSelect ? <FluentButton type="button" appearance="subtle" className="enterprise-analytical-control" onClick={() => onSelect(item)} aria-label={`${item.label}: ${item.value} ${valueLabel}`}>{bar}<span>{item.label}</span><strong>{item.value}</strong></FluentButton> : <div>{bar}<span>{item.label}</span><strong>{item.value}</strong></div>}</div>; })}</div></section>; }

export function ObjectSection({ title, eyebrow, children, actions, id }:{title:string;eyebrow?:string;children:ReactNode;actions?:ReactNode;id?:string}) { return <section className="enterprise-object-section" id={id} aria-labelledby={id ? `${id}-title` : undefined}><header className="enterprise-object-section-header"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h3 id={id ? `${id}-title` : undefined}>{title}</h3></div>{actions && <div className="enterprise-object-section-actions">{actions}</div>}</header>{children}</section>; }
export function EmptyState({ title, description, action, children }:{title:string;description?:string;action?:ReactNode;children?:ReactNode}) { return <div className="enterprise-empty-state" role="status"><h3>{title}</h3>{description && <p>{description}</p>}{children}{action}</div>; }
export function LoadingState({ label='Carregando dados…' }:{label?:string}) { return <div className="enterprise-loading-state" role="status" aria-live="polite" aria-busy="true"><FluentSpinner size="tiny"/><span>{label}</span></div>; }
export function ErrorState({ message, onRetry }:{message:string;onRetry?:()=>void}) { return <FluentMessageBar className="enterprise-error-state" intent="error" role="alert"><MessageBarBody><MessageBarTitle>Não foi possível concluir</MessageBarTitle><p>{message}</p>{onRetry && <EnterpriseButton type="button" className="secondary" onClick={onRetry}>Tentar novamente</EnterpriseButton>}</MessageBarBody></FluentMessageBar>; }

type ErrorBoundaryProps = { children:ReactNode; fallback?:ReactNode; onError?:(error:Error, info:ErrorInfo)=>void };
type ErrorBoundaryState = { error:Error|null };
export class EnterpriseErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> { state:ErrorBoundaryState = { error:null }; static getDerivedStateFromError(error:Error):ErrorBoundaryState { return { error }; } componentDidCatch(error:Error, info:ErrorInfo) { this.props.onError?.(error, info); } reset = (event?:MouseEvent<HTMLButtonElement>) => { event?.preventDefault(); this.setState({ error:null }); }; render() { if (!this.state.error) return this.props.children; return this.props.fallback ?? <ErrorState message="Ocorreu um erro inesperado nesta área." onRetry={this.reset} />; } }
export function EnterpriseErrorFallback({ title='Área indisponível', description, onRetry }:{title?:string;description?:string;onRetry?:()=>void}) { return <FluentMessageBar className="enterprise-error-state" intent="error" role="alert"><MessageBarBody><MessageBarTitle>{title}</MessageBarTitle><p>{description ?? 'Não foi possível carregar este conteúdo.'}</p>{onRetry && <EnterpriseButton type="button" className="secondary" onClick={onRetry}>Tentar novamente</EnterpriseButton>}</MessageBarBody></FluentMessageBar>; }
