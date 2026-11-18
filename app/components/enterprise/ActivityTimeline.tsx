'use client';

import { useState, useTransition } from 'react';
import { Clock3 } from 'lucide-react';
import { BusinessStatus } from './EnterprisePrimitives';

/**
 * Adapted from NextCRM's components/crm/audit-log/Timeline.tsx
 * Source: https://github.com/pdovhomilja/nextcrm-app
 * Commit: d3bead9b44efe2cf94d0dfc2948af0f2c9270deb
 * License: MIT (copyright Pavel Dovhomilja, notice retained in docs/third-party).
 */
export type TimelineEntry = { id: string; title: string; detail: string; timestamp: string; tone?: 'positive'|'warning'|'neutral' };
export function ActivityTimeline({ entries, emptyLabel = 'Nenhuma atividade registrada.', onLoadMore }: { entries: TimelineEntry[]; emptyLabel?: string; onLoadMore?: () => Promise<TimelineEntry[]> }) {
 const [items, setItems] = useState(entries); const [pending, startTransition] = useTransition();
 if (!items.length) return <p className="enterprise-muted">{emptyLabel}</p>;
 const loadMore=()=>startTransition(async()=>{if(onLoadMore){const more=await onLoadMore();setItems(prev=>[...prev,...more])}});
 return <div className="enterprise-timeline">{items.map(entry => <div className="enterprise-timeline-row" key={entry.id}><span className={'enterprise-timeline-dot '+(entry.tone||'neutral')} /><div><strong>{entry.title}</strong><small>{entry.detail}</small><time>{entry.timestamp}</time><BusinessStatus status={entry.tone==='positive'?'completed':entry.tone==='warning'?'warning':'in_progress'} /></div></div>)}{onLoadMore&&<button className="enterprise-timeline-more" disabled={pending} onClick={loadMore}>{pending?'Carregando…':'Carregar mais'}</button>}<Clock3 size={14} className="enterprise-timeline-icon" /></div>;
}
