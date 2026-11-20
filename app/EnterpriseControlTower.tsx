'use client';
import {useEffect,useState} from 'react';
import {EnterpriseButton,EnterpriseInput} from './components/enterprise/EnterprisePrimitives';
import {moneyScaled} from '../lib/domain/orders';
import EnterpriseApprovalsInbox from './EnterpriseApprovalsInbox';

export type ControlTowerLaneId='lateOrders'|'unmeasuredOrders'|'overdueReceivables'|'overduePayables'|'latePurchases'|'stockShortage'|'myApprovals';
type LaneItem={id:string;title:string;reference:string|null;date:string|null;amountScaled:string|null;availableScaled:string|null;requiredScaled:string|null;unit?:string|null};
type Lane={id:ControlTowerLaneId;label:string;target:string;count:number;totalAmountScaled:string|null;authority:string;items:LaneItem[]};
type Snapshot={asOf:string;generatedAt:string;authority:string;sampleLimitPerLane:number;lanes:Lane[];error?:string};
const recordAccessible=new Set<ControlTowerLaneId>(['lateOrders','unmeasuredOrders','overdueReceivables','overduePayables','latePurchases','stockShortage']);
function amount(value:string|null){return value==null?'':moneyScaled(value);}
function quantity(value:string|null){
 if(value==null||!(/^-?\d+$/).test(value))return '—';
 const n=BigInt(value),abs=n<0n?-n:n,whole=abs/1000n,decimal=(abs%1000n).toString().padStart(3,'0').replace(/0+$/,'');
 return (n<0n?'-':'')+new Intl.NumberFormat('pt-BR').format(whole)+(decimal?','+decimal:'');
}
function date(value:string|null){
 if(!value)return 'Data não informada';
 const day=value.slice(0,10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return 'Data não informada';
 return day.slice(8,10)+'/'+day.slice(5,7)+'/'+day.slice(0,4);
}
export default function EnterpriseControlTower({onLane,onRecord}:{
 onLane:(lane:ControlTowerLaneId,asOf:string)=>void;
 onRecord:(lane:ControlTowerLaneId,id:string,asOf:string)=>void;
}){
 const [cutoff,setCutoff]=useState('');
 const [revision,setRevision]=useState(0);
 const [showApprovals,setShowApprovals]=useState(false);
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 useEffect(()=>{
  const controller=new AbortController();
  async function load(){
   setLoading(true);setError('');
   try{
    const url='/api/enterprise/control-tower'+(cutoff?'?'+new URLSearchParams({asOf:cutoff}):'');
    const response=await fetch(url,{signal:controller.signal,cache:'no-store'});
    const data=await response.json() as Snapshot;
    if(!response.ok)throw new Error(data.error||'Fila de prioridades indisponível.');
    if(data.authority!=='owner_scoped_persisted_postgresql.v1'||!Array.isArray(data.lanes)||data.lanes.length!==7)
      throw new Error('O servidor não confirmou as sete filas empresariais autorizadas.');
    if(!controller.signal.aborted)setSnapshot(data);
   }catch(cause){
    if(!controller.signal.aborted){setSnapshot(null);setError(cause instanceof Error?cause.message:'Falha na consulta empresarial.');}
   }finally{if(!controller.signal.aborted)setLoading(false);}
  }
  void load();
  return()=>controller.abort();
 },[cutoff,revision]);
 return <section className="enterprise-control-tower" aria-label="Central de exceções empresariais">
  <header className="enterprise-control-heading">
   <div><span className="eyebrow">PRIORIDADES TRANSACIONAIS</span><h2>Central de exceções empresariais</h2>
    <p>Filas apuradas por consultas PostgreSQL vinculadas ao proprietário autorizado. Abrir um item não executa comandos financeiros.</p></div>
   <div className="enterprise-control-tools">
    <label>Data de referência<EnterpriseInput type="date" aria-label="Data de referência das exceções" value={cutoff} onChange={event=>setCutoff(event.currentTarget.value)}/></label>
    <EnterpriseButton type="button" className="secondary" disabled={loading} onClick={()=>setRevision(n=>n+1)}>Atualizar exceções</EnterpriseButton>
   </div>
  </header>
  {loading&&<p role="status" className="linked-info">Consultando registros autorizados…</p>}
  {error&&<div role="alert" className="enterprise-control-error"><p>{error}</p><EnterpriseButton type="button" onClick={()=>setRevision(n=>n+1)}>Tentar novamente</EnterpriseButton></div>}
  {!loading&&!error&&snapshot&&<><div className="enterprise-control-lanes">
   {snapshot.lanes.map(lane=><article className="enterprise-control-lane" key={lane.id} aria-label={lane.label}>
    <header><div><h3>{lane.label}</h3><span className="enterprise-control-count">{lane.count} registro{lane.count===1?'':'s'}</span>
      {lane.totalAmountScaled!==null&&<small>Saldo documentado: {amount(lane.totalAmountScaled)}</small>}</div>
      <EnterpriseButton type="button" appearance="subtle" onClick={()=>lane.id==='myApprovals'?setShowApprovals(true):onLane(lane.id,snapshot.asOf)}>{lane.id==='myApprovals'?'Abrir aprovações':'Abrir área'}</EnterpriseButton>
    </header>
    {lane.items.length>0?<ol className="enterprise-control-items">{lane.items.map(item=><li key={item.id}>
      <div><strong>{item.title}</strong><small>{item.reference??item.id.slice(0,12)} · {date(item.date)}</small>
      {item.amountScaled!==null&&<span>Saldo: {amount(item.amountScaled)}</span>}
      {lane.id==='stockShortage'&&<span>Disponível {quantity(item.availableScaled)} / mínimo {quantity(item.requiredScaled)}{item.unit?' '+item.unit:''}</span>}
      </div>
      {recordAccessible.has(lane.id)?<EnterpriseButton type="button" appearance="subtle" onClick={()=>onRecord(lane.id,item.id,snapshot.asOf)} aria-label={'Abrir '+item.title}>Abrir registro</EnterpriseButton>:
       lane.id==='myApprovals'?<EnterpriseButton type="button" appearance="subtle" onClick={()=>setShowApprovals(true)}>Revisar na caixa</EnterpriseButton>:<span className="enterprise-control-no-link">Abertura individual não disponível</span>}
    </li>)}</ol>:<p className="enterprise-control-empty">Nenhuma exceção encontrada para este filtro.</p>}
    {lane.count>lane.items.length&&<p className="enterprise-control-more">Exibidos {lane.items.length} de {lane.count}. Consulte a área para os demais registros.</p>}
   </article>)}
  </div><footer className="enterprise-control-provenance">
   <span>Fonte: consultas transacionais por proprietário · referência {date(snapshot.asOf)}</span>
   <span>Dados consultados; este painel não confirma uma jornada ponta a ponta.</span>
  </footer></>}
  {showApprovals&&<EnterpriseApprovalsInbox onClose={()=>setShowApprovals(false)} onDecided={()=>setRevision(n=>n+1)}/>}
 </section>;
}
