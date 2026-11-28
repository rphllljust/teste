'use client';
import {useEffect,useState,type FormEvent} from 'react';
type Reservation={id:string;itemId:string;sku:string;name:string;unit:string;
 quantityMilli:string;consumedMilli:string;status:string;reference:string};
type Allocation={id:string;resourceType:string;resourceId:string;resourceName:string;
 startsAt:string;endsAt:string;status:string};
type Consumption={id:string;sku:string;name:string;quantityMilli:string;unit:string;
 sourceVerified:boolean;reference:string};
type Dossier={status:string;needStatus:string;orderId:string|null;orderStatus:string|null;
 canMutate:boolean;canReserve:boolean;canConsume:boolean;canAllocate:boolean;
 findings:Array<{code:string;ok:boolean;detail:string}>;
 reservations:Reservation[];resources:Allocation[];consumption:Consumption[];
 summary:{plannedMaterialLines:number;plannedResourceLines:number;reservationCount:number;
 activeAllocationCount:number;consumptionEvents:number;brokenConsumptionEvidence:number;truncated:boolean};
 caution:string};
type Item={id:string;sku:string;name:string;unit:string};
type Resource={id:string;name:string;status:string};
const parseQty=(v:string)=>{
 const m=v.trim().match(/^(\d{1,9})(?:[,.](\d{1,3}))?$/);
 if(!m)return null;
 const result=Number(m[1])*1000+Number((m[2]??'').padEnd(3,'0'));
 return Number.isSafeInteger(result)&&result>0?result:null;
};
const fmt=(v:string)=> (Number(v)/1000).toLocaleString('pt-BR',{maximumFractionDigits:3});
const url=(t:string,n:string)=>'/api/enterprise/tenants/'+encodeURIComponent(t)+
 '/service-needs/'+encodeURIComponent(n)+'/logistics';
export default function ServiceNeedsLogisticsPanel({tenantId,needId,revision=0,onRefresh}:{
 tenantId:string;needId:string;revision?:number;onRefresh:()=>void;
}){
 const [d,setD]=useState<Dossier|null>(null),[items,setItems]=useState<Item[]>([]);
 const [assets,setAssets]=useState<Resource[]>([]),[staff,setStaff]=useState<Resource[]>([]);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[version,setVersion]=useState(0);
 const [itemId,setItemId]=useState(''),[quantity,setQuantity]=useState('1'),[reference,setReference]=useState('');
 const [reservationId,setReservationId]=useState(''),[resourceType,setResourceType]=useState<'asset'|'professional'>('asset');
 const [resourceId,setResourceId]=useState(''),[start,setStart]=useState(''),[end,setEnd]=useState('');
 useEffect(()=>{
  const ac=new AbortController();
  void fetch(url(tenantId,needId),{credentials:'same-origin',cache:'no-store',signal:ac.signal})
   .then(async r=>{const x=await r.json() as Dossier&{error?:string};
    if(!r.ok)throw Error(x.error??'Dossiê de materiais indisponível.');
    if(!ac.signal.aborted){setD(x);setError('');}
    if(!x.canMutate)return;
    const rr=await Promise.all([
     fetch('/api/inventory?page=1',{credentials:'same-origin',signal:ac.signal}),
     fetch('/api/assets?page=1&pageSize=50',{credentials:'same-origin',signal:ac.signal}),
     fetch('/api/professionals?page=1&pageSize=50',{credentials:'same-origin',signal:ac.signal}),
    ]);
    const bodies=await Promise.all(rr.map(z=>z.json() as Promise<{items?:unknown[];error?:string}>));
    if(rr.some(z=>!z.ok))throw Error('Listas de materiais e recursos indisponíveis para alocação.');
    if(!ac.signal.aborted){setItems((bodies[0].items??[]) as Item[]);setAssets((bodies[1].items??[]) as Resource[]);setStaff((bodies[2].items??[]) as Resource[]);}
   }).catch(e=>{if(!ac.signal.aborted)setError(e instanceof Error?e.message:'Falha ao consultar logística.');});
  return()=>ac.abort();
 },[tenantId,needId,revision,version]);
 async function command(endpoint:string,payload:object,success:string){
  setBusy(true);setError('');setNotice('');
  try{
   const r=await fetch(endpoint,{method:'POST',credentials:'same-origin',
    headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
   const body=await r.json() as {error?:string};
   if(!r.ok)throw Error(body.error??'Comando logístico recusado.');
   setNotice(success);setVersion(v=>v+1);onRefresh();
  }catch(e){setError(e instanceof Error?e.message:'Operação indisponível.');}finally{setBusy(false);}
 }
 function reserve(e:FormEvent<HTMLFormElement>){
  e.preventDefault();
  if(!d?.canReserve||!itemId||parseQty(quantity)===null)return;
  void command('/api/inventory',{
   type:'reserve',id:crypto.randomUUID(),itemId,sourceDocumentType:'service-order',
   sourceDocumentId:d.orderId,quantity,reference:reference.trim(),
  },'Material reservado para esta OS. A disponibilidade foi revalidada transacionalmente.');
 }
 function consume(e:FormEvent<HTMLFormElement>){
  e.preventDefault();
  const reserved=d?.reservations.find(x=>x.id===reservationId);
  if(!d?.canConsume||!reserved||parseQty(quantity)===null)return;
  void command('/api/inventory',{
   type:'consume',id:crypto.randomUUID(),itemId:reserved.itemId,
   reservationId,orderId:d.orderId,quantity,reference:reference.trim(),
  },'Consumo debitado do estoque e vinculado à OS e à reserva.');
 }
 async function allocate(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!d?.canAllocate||!resourceId)return;
  const startDate=new Date(start),endDate=new Date(end);
  if(!Number.isFinite(startDate.getTime())||!Number.isFinite(endDate.getTime())||endDate<=startDate){
   setError('Janela de reserva inválida.');return;
  }
  setBusy(true);setError('');setNotice('');
  try{
   const candidate={orderId:d.orderId,resourceType,resourceId,
    startsAt:startDate.toISOString(),endsAt:endDate.toISOString()};
   const preview=await fetch('/api/resources/allocations/preflight',{method:'POST',credentials:'same-origin',
    headers:{'content-type':'application/json'},body:JSON.stringify(candidate)});
   const p=await preview.json() as {ready:boolean;findings:Array<{ok:boolean;detail:string}>;error?:string};
   if(!preview.ok)throw Error(p.error??'Pré-verificação recusada.');
   if(!p.ready)throw Error(p.findings.filter(x=>!x.ok).map(x=>x.detail).join(' '));
   const r=await fetch('/api/resources/allocations',{method:'POST',credentials:'same-origin',
    headers:{'content-type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),...candidate})});
   const x=await r.json() as {error?:string};if(!r.ok)throw Error(x.error??'Recurso indisponível.');
   setNotice('Recurso reservado na agenda com bloqueio real de sobreposição.');
   setVersion(v=>v+1);onRefresh();
  }catch(e){setError(e instanceof Error?e.message:'Falha na alocação.');}finally{setBusy(false);}
 }
 const selectedReservation=d?.reservations.find(x=>x.id===reservationId);
 const choices=(resourceType==='asset'?assets:staff).filter(x=>x.status==='active');
 return <section className="enterprise-governance-panel" aria-label="Logística e materiais integrados à ordem de serviço">
  <div className="form-row"><h3>Logística da OS · material, estoque e capacidade</h3>
   <button type="button" className="secondary" disabled={busy} onClick={()=>setVersion(v=>v+1)}>Revalidar</button></div>
  {error&&<p role="alert" className="form-error">{error}</p>}
  {notice&&<p role="status">{notice}</p>}
  {!d&&!error&&<p role="status">Lendo reservas, consumos e agenda do PostgreSQL…</p>}
  {d&&<>
   <p><strong>{d.status==='EVIDENCE_RECORDED'?'Evidências registradas':'Pendências logísticas identificadas'}</strong>
    {' · '}OS {d.orderStatus} · materiais planejados: {d.summary.plannedMaterialLines}
    {' · '}recursos planejados: {d.summary.plannedResourceLines}</p>
   <ul>{d.findings.map(f=><li key={f.code}>{f.ok?'Conforme':'Pendente'} · {f.detail}</li>)}</ul>
   {!d.canMutate&&<p>Consulta disponível ao segundo controlador. Reservas, consumos e alocações são comandados somente pela identidade titular da OS.</p>}
   <details open><summary>Reservas de estoque · {d.reservations.length}</summary>
    {d.reservations.map(r=><p key={r.id}>{r.sku} · {r.name} · {fmt(r.quantityMilli)} {r.unit}
     {' · '}consumido {fmt(r.consumedMilli)} · {r.status} · {r.reference}</p>)}
   </details>
   <details><summary>Consumos documentados · {d.consumption.length}</summary>
    {d.consumption.map(x=><p key={x.id}>{x.sku} · {fmt(x.quantityMilli)} {x.unit}
     {' · '}{x.sourceVerified?'Reserva e saída conferidas':'Vínculo de estoque inconsistente'} · {x.reference}</p>)}
   </details>
   <details><summary>Agenda de recursos · {d.resources.length}</summary>
    {d.resources.map(x=><p key={x.id}>{x.resourceName} ({x.resourceType}) · {x.startsAt} — {x.endsAt} · {x.status}</p>)}
   </details>
   {d.canReserve&&<form className="enterprise-governance-panel" onSubmit={reserve}>
    <h4>Reservar material para a OS</h4>
    <label>Material em estoque<select required value={itemId} onChange={e=>setItemId(e.target.value)}>
     <option value="">Selecione um material</option>{items.map(x=><option key={x.id} value={x.id}>{x.sku} · {x.name} ({x.unit})</option>)}
    </select></label>
    <label>Quantidade na unidade do material<input required value={quantity} onChange={e=>setQuantity(e.target.value)} inputMode="decimal" placeholder="1,000"/></label>
    <label>Referência da requisição<input required minLength={3} maxLength={160} value={reference} onChange={e=>setReference(e.target.value)}/></label>
    <button type="submit" disabled={busy||!itemId||parseQty(quantity)===null||reference.trim().length<3}>Reservar disponibilidade</button>
   </form>}
   {d.canConsume&&<form className="enterprise-governance-panel" onSubmit={consume}>
    <h4>Baixar material reservado na execução</h4>
    <label>Reserva vinculada à OS<select required value={reservationId} onChange={e=>setReservationId(e.target.value)}>
     <option value="">Selecione a reserva</option>
     {d.reservations.filter(x=>x.status==='reserved').map(x=><option key={x.id} value={x.id}>{x.sku} · disponível {fmt((BigInt(x.quantityMilli)-BigInt(x.consumedMilli)).toString())} {x.unit}</option>)}
    </select></label>
    <label>Quantidade consumida<input required value={quantity} onChange={e=>setQuantity(e.target.value)} inputMode="decimal"/></label>
    <label>Referência de saída<input required minLength={3} maxLength={160} value={reference} onChange={e=>setReference(e.target.value)}/></label>
    <button type="submit" disabled={busy||!selectedReservation||parseQty(quantity)===null||reference.trim().length<3}>Registrar consumo da OS</button>
   </form>}
   {d.canAllocate&&<form className="enterprise-governance-panel" onSubmit={e=>void allocate(e)}>
    <h4>Alocar recurso operacional na OS</h4>
    <label>Tipo<select value={resourceType} onChange={e=>{setResourceType(e.target.value as 'asset'|'professional');setResourceId('');}}>
     <option value="asset">Equipamento/veículo</option><option value="professional">Profissional</option>
    </select></label>
    <label>Recurso ativo<select required value={resourceId} onChange={e=>setResourceId(e.target.value)}>
     <option value="">Selecione</option>{choices.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
    </select></label>
    <label>Início<input required type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/></label>
    <label>Fim<input required type="datetime-local" value={end} onChange={e=>setEnd(e.target.value)}/></label>
    <button type="submit" disabled={busy||!resourceId||!start||!end}>Validar conflitos e alocar</button>
   </form>}
   {d.summary.truncated&&<p role="alert">Consulta de logística limitada a 100 registros por origem. É necessário conferir o histórico completo antes de certificar a operação.</p>}
   <p>{d.caution}</p>
  </>}
 </section>;
}
