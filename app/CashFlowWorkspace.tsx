'use client';
import { EnterpriseDataGrid } from './components/enterprise/EnterprisePrimitives';

import { EnterpriseInput } from './components/enterprise/EnterprisePrimitives';
import { useEffect, useState } from 'react';
import { moneyScaled } from '../lib/domain/orders';

type Flow={date:string;projectedIn:number;projectedOut:number;realizedIn:number;realizedOut:number;netProjected:number;netRealized:number};
type Result={from:string;to:string;openingBankBalanceScaled:string;items:Flow[];summary:{projectedIn:number;projectedOut:number;realizedIn:number;realizedOut:number;netProjected:number;netRealized:number};warnings:string[]};
const amount=(value:number|string)=>moneyScaled(String(value));
export default function CashFlowWorkspace(){
 const [from,setFrom]=useState(''),[to,setTo]=useState(''),[data,setData]=useState<Result|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();const params=new URLSearchParams();if(from)params.set('from',from);if(to)params.set('to',to);fetch('/api/finance/cash-flow?'+params,{signal:controller.signal}).then(async response=>{const body=await response.json() as Result&{error?:string};if(!response.ok)throw new Error(body.error);if(!controller.signal.aborted)setData(body);}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Fluxo de caixa indisponível.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[from,to]);
 return <section className="worklist" aria-busy={loading}><div className="list-title"><div><h2>Fluxo de caixa</h2><p>Visão separada entre compromissos projetados, movimentos realizados e saldo bancário informado.</p></div></div><div className="filters"><label className="select-filter">De<EnterpriseInput type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label className="select-filter">Até<EnterpriseInput type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div>{loading?<div className="empty" role="status">Calculando fluxo financeiro…</div>:error?<div className="empty" role="alert">{error}</div>:data&&<><section className="metrics" aria-label="Totais de fluxo de caixa"><div><span>Entradas projetadas</span><strong>{amount(data.summary.projectedIn)}</strong><small>títulos em aberto</small></div><div><span>Saídas projetadas</span><strong>{amount(data.summary.projectedOut)}</strong><small>obrigações em aberto</small></div><div><span>Entradas realizadas</span><strong>{amount(data.summary.realizedIn)}</strong><small>recebimentos</small></div><div><span>Saídas realizadas</span><strong>{amount(data.summary.realizedOut)}</strong><small>pagamentos</small></div></section><div className="linked-info">Saldo bancário informado no último extrato: <strong>{amount(data.openingBankBalanceScaled)}</strong>. Não representa saldo bancário em tempo real.</div>{data.items.length?<EnterpriseDataGrid<Flow>
  caption="Fluxo de caixa por data"
  rows={data.items}
  getRowKey={(item)=>item.date}
  columns={[
 {key:'date',header:'Data',render:item=>new Intl.DateTimeFormat('pt-BR',{timeZone:'UTC'}).format(new Date(item.date+'T12:00:00Z'))},
 {key:'projectedin',header:'Entradas projetadas',render:item=><span className="amount">{amount(item.projectedIn)}</span>},
 {key:'projectedout',header:'Saídas projetadas',render:item=><span className="amount">{amount(item.projectedOut)}</span>},
 {key:'realized',header:'Realizado líquido',render:item=><span className="amount">{amount(item.netRealized)}</span>},
 {key:'projected',header:'Projetado líquido',render:item=><span className="amount">{amount(item.netProjected)}</span>}
]}
 />:<div className="empty"><h3>Nenhum movimento no período</h3><p>Não há títulos ou lançamentos persistidos para a janela consultada.</p></div>}{data.warnings.map(w=><p className="muted finance-source-note" key={w}>{w}</p>)}</>}</section>;
}
