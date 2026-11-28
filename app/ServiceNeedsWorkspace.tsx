'use client';
import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {EnterprisePageHeader} from './components/enterprise/EnterprisePrimitives';
import ServiceNeedsCommercialPanel,{type Commercial,type Request as AdditionalRequest} from './ServiceNeedsCommercialPanel';
import ServiceNeedEmployeeFieldPanel from './ServiceNeedEmployeeFieldPanel';
import ServiceNeedsReadinessPanel from './ServiceNeedsReadinessPanel';

type Tenant={id:string;name:string;role:string};
type Need={id:string;channel:string;originRef:string;clientName:string;contactName:string;serviceDescription:string;requestedDate:string;priority:string;status:string;orderId:string|null};
type Event={event:string;actorId:string;reason:string|null;createdAt:string};
type Detail={need:Need;events:Event[];planned:{kind:string;resourceRef:string;quantityMilli:number;unit:string}[];actual:{kind:string;resourceRef:string;quantityMilli:number;unit:string}[];assignments:{id:string;employeeActorId:string;events:string[]}[];financials?:{estimatedCostCents:number;marginBps:number}|null;commercial?:Commercial;additionalRequests?:AdditionalRequest[];fieldEvents?:{id:string;eventType:string;description:string;quantityMilli:string|null;unit:string|null;evidenceRef:string|null;actorId:string;createdAt:string}[]};
type InboxItem={assignmentId:string;needId:string;orderId:string|null;clientName:string;serviceDescription:string;location:string;requestedDate:string;status:string;events:string[];planned:{kind:string;resourceRef:string;quantityMilli:string;unit:string}[]};
const uuid=()=>crypto.randomUUID();
async function api<T>(url:string,body?:object):Promise<T>{
 const response=await fetch(url,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
 const parsed=await response.json() as T&{error?:string};
 if(!response.ok)throw new Error(parsed.error||'Operação indisponível.');
 return parsed;
}
export default function ServiceNeedsWorkspace({mode='needs',onOpenOrder}:{mode?:'needs'|'inbox';onOpenOrder?:(id:string)=>void}){
 const [tenants,setTenants]=useState<Tenant[]>([]);
 const [tenantId,setTenantId]=useState('');
 const [items,setItems]=useState<Need[]>([]);
 const [inbox,setInbox]=useState<InboxItem[]>([]);
 const [selected,setSelected]=useState('');
 const [detail,setDetail]=useState<Detail|null>(null);
 const [pending,setPending]=useState(false);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [revision,setRevision]=useState(0);
 const [reason,setReason]=useState('');
 const [orderCategory,setOrderCategory]=useState('Serviços');
 const [employeeId,setEmployeeId]=useState('');
 const [professionalId,setProfessionalId]=useState('');
 const [proposalRef,setProposalRef]=useState('');
 const [rcRef,setRcRef]=useState('');
 const [otherRefs,setOtherRefs]=useState('');
 const [contactPhone,setContactPhone]=useState('');
 const [contactEmail,setContactEmail]=useState('');
 const [planRef,setPlanRef]=useState('');
 const [planQuantity,setPlanQuantity]=useState('1');
 const [planUnit,setPlanUnit]=useState('h');
 const [additional,setAdditional]=useState('');
 const [evidence,setEvidence]=useState('');
 const [clientName,setClientName]=useState('');
 const [contactName,setContactName]=useState('');
 const [originRef,setOriginRef]=useState('');
 const [description,setDescription]=useState('');
 const [location,setLocation]=useState('');
 const [requestedDate,setRequestedDate]=useState('');
 const [channel,setChannel]=useState('portal');
 const [priority,setPriority]=useState('normal');
 const [contractRef,setContractRef]=useState('');
 const [poRef,setPoRef]=useState('');
 const [commercialTerms,setCommercialTerms]=useState('');
 const tenant=tenants.find(x=>x.id===tenantId);
 const root='/api/enterprise/tenants/'+encodeURIComponent(tenantId);
 const refresh=useCallback(()=>setRevision(v=>v+1),[]);
 useEffect(()=>{
  let live=true;
  void api<{items:Tenant[]}>('/api/enterprise/tenants').then(x=>{
   if(!live)return;setTenants(x.items);setTenantId(prev=>x.items.some(t=>t.id===prev)?prev:x.items[0]?.id??'');
  }).catch(e=>{if(live)setError((e as Error).message);});
  return()=>{live=false;};
 },[]);
 useEffect(()=>{
  if(!tenantId)return;
  let live=true;
  const base='/api/enterprise/tenants/'+encodeURIComponent(tenantId);
  const run=async()=>{
   try{
    const [queue,assigned]=await Promise.all([
     mode==='needs'?api<{items:Need[]}>(base+'/service-needs'):Promise.resolve({items:[] as Need[]}),
     mode==='inbox'?api<{items:InboxItem[]}>(base+'/employee-inbox'):Promise.resolve({items:[] as InboxItem[]})
    ]);
    if(!live)return;
    setItems(queue.items);setInbox(assigned.items);
    setSelected(prev=>queue.items.some(x=>x.id===prev)?prev:'');
    setError('');
   }catch(e){if(live){setError((e as Error).message);setItems([]);setInbox([]);}}
  };
  void run();
  return()=>{live=false;};
 },[tenantId,mode,revision]);
 useEffect(()=>{
  if(!selected||!tenantId){return;}
  let live=true;
  void api<Detail>('/api/enterprise/tenants/'+encodeURIComponent(tenantId)+'/service-needs/'+encodeURIComponent(selected))
   .then(x=>{if(live)setDetail(x);}).catch(e=>{if(live)setError((e as Error).message);});
  return()=>{live=false;};
 },[tenantId,selected,revision]);
 const submit=async(url:string,body:object,success:string)=>{
  setPending(true);setError('');setNotice('');
  try{await api(url,body);setNotice(success);refresh();}
  catch(e){setError((e as Error).message);}
  finally{setPending(false);}
 };
 const command=(needId:string,commandName:string,data:Record<string,unknown>={})=>
  submit(root+'/service-needs/'+encodeURIComponent(needId)+'/commands',{commandKey:uuid(),command:commandName,...data},'Comando registrado e auditado.');
 async function createNeed(e:FormEvent<HTMLFormElement>){
  e.preventDefault();
  await submit(root+'/service-needs',{id:uuid(),commandKey:uuid(),channel,priority,originRef,clientName,contactName,contactPhone:contactPhone||null,contactEmail:contactEmail||null,serviceDescription:description,location,requestedDate,proposalRef:proposalRef||null,contractRef:contractRef||null,poRef:poRef||null,rcRef:rcRef||null,otherRefs:otherRefs||null,commercialTerms:commercialTerms||null},'Necessidade recebida e registrada.');
 }
 return <section className="enterprise-governance enterprise-governance-embedded" aria-label={mode==='needs'?'Necessidades de serviço':'Caixa do empregado'}>
  <EnterprisePageHeader eyebrow="OPERAÇÕES · FLUXO TRANSACIONAL"
   title={mode==='needs'?'Necessidades de serviço':'Minha caixa de ordens'}
   description={mode==='needs'?'Entrada, análise, aprovação, OS, planejamento, liberação e atribuição com trilha auditável.':'Atribuições recebidas da empresa, confirmação pessoal e início de execução.'}
   actions={<button type="button" className="secondary" onClick={refresh} disabled={pending}>Atualizar</button>}/>
  <div className="enterprise-governance-panel">
   <label>Empresa ativa
    <select value={tenantId} onChange={e=>{setTenantId(e.target.value);setSelected('');setDetail(null);setError('');}}>
     {tenants.length===0&&<option value="">Nenhuma empresa vinculada</option>}
     {tenants.map(t=><option value={t.id} key={t.id}>{t.name} · {t.role}</option>)}
    </select>
   </label>
   {error&&<p role="alert" className="form-error">{error}</p>}
   {notice&&<p role="status" className="linked-info">{notice}</p>}
   {!tenantId&&<p>É necessário possuir vínculo ativo com uma organização.</p>}
  </div>
  {tenantId&&mode==='inbox'&&<div className="enterprise-governance-panel">
   <h2>Ordens atribuídas a esta identidade</h2>
   {!inbox.length&&<p>Não há atribuições autenticadas para esta identidade. A conta compartilhada do staging não substitui a conta do empregado.</p>}
   {inbox.map(x=><article key={x.assignmentId} className="enterprise-governance-panel">
    <strong>{x.clientName}</strong><p>{x.serviceDescription}</p>
    <p>{x.location} · {x.requestedDate} · {x.status} · {x.events.join(' → ')}</p>
    <div className="form-row">
     {!x.events.includes('viewed')&&<button type="button" disabled={pending} onClick={()=>void command(x.needId,'mark_viewed',{assignmentId:x.assignmentId})}>Confirmar visualização</button>}
     {x.events.includes('viewed')&&!x.events.includes('received')&&<button type="button" disabled={pending} onClick={()=>void command(x.needId,'mark_received',{assignmentId:x.assignmentId})}>Confirmar recebimento</button>}
     {x.events.includes('received')&&x.status==='released'&&<button type="button" className="primary" disabled={pending} onClick={()=>void command(x.needId,'start_execution',{assignmentId:x.assignmentId})}>Iniciar execução</button>}
     {x.status==='executing'&&<ServiceNeedEmployeeFieldPanel key={x.assignmentId} tenantId={tenantId} needId={x.needId} assignmentId={x.assignmentId} planned={x.planned??[]} onRefresh={refresh}/> }
    </div>
   </article>)}
  </div>}
  {tenantId&&mode==='needs'&&<>
   {tenant?.role==='owner'&&<ServiceNeedsReadinessPanel tenantId={tenantId}/>}
   <div className="enterprise-governance-panel">
    <details>
     <summary><strong>Nova necessidade de serviço</strong> · registrar canal, responsável e referências documentais</summary>
     <form onSubmit={e=>void createNeed(e)} className="enterprise-governance-panel">
      <div className="form-row">
       <label>Canal<select value={channel} onChange={e=>setChannel(e.target.value)}><option value="portal">Portal</option><option value="phone">Telefone</option><option value="whatsapp">WhatsApp</option><option value="email">E-mail</option><option value="visit">Visita</option><option value="contract">Contrato</option><option value="other">Outro</option></select></label>
       <label>Prioridade<select value={priority} onChange={e=>setPriority(e.target.value)}><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option><option value="low">Baixa</option></select></label>
       <label>Referência de origem<input required value={originRef} onChange={e=>setOriginRef(e.target.value)}/></label>
       <label>Cliente<input required minLength={2} value={clientName} onChange={e=>setClientName(e.target.value)}/></label>
       <label>Contato<input required minLength={2} value={contactName} onChange={e=>setContactName(e.target.value)}/></label>
       <label>Telefone<input value={contactPhone} maxLength={40} onChange={e=>setContactPhone(e.target.value)}/></label>
       <label>E-mail<input value={contactEmail} maxLength={200} onChange={e=>setContactEmail(e.target.value)}/></label>
       <label>Proposta<input value={proposalRef} onChange={e=>setProposalRef(e.target.value)}/></label>
       <label>RC<input value={rcRef} onChange={e=>setRcRef(e.target.value)}/></label>
       <label>Outros documentos<input value={otherRefs} onChange={e=>setOtherRefs(e.target.value)}/></label>
       <label>Data solicitada<input type="date" required value={requestedDate} onChange={e=>setRequestedDate(e.target.value)}/></label>
       <label>Local<input required minLength={2} value={location} onChange={e=>setLocation(e.target.value)}/></label>
       <label>Contrato<input value={contractRef} onChange={e=>setContractRef(e.target.value)}/></label>
       <label>PO<input value={poRef} onChange={e=>setPoRef(e.target.value)}/></label>
      </div>
      <label>Descrição<input required minLength={3} value={description} onChange={e=>setDescription(e.target.value)}/></label>
      <label>Condições comerciais<input value={commercialTerms} onChange={e=>setCommercialTerms(e.target.value)}/></label>
      <button className="primary" disabled={pending}>Registrar necessidade</button>
     </form>
    </details>
   </div>
   <div className="enterprise-governance-panel">
    <h2>Fila de necessidades · {items.length}</h2>
    {!items.length&&<p>Nenhuma necessidade disponível para a função autenticada.</p>}
    <div role="list" className="enterprise-governance-layout">
     {items.map(n=><button type="button" role="listitem" key={n.id} disabled={pending} aria-pressed={selected===n.id} className={selected===n.id?'primary':'secondary'}
      onClick={()=>{setSelected(n.id);setDetail(null);setNotice('');}}>
      {n.clientName} · {n.priority} · {n.status} · {n.requestedDate}
     </button>)}
    </div>
   </div>
   {selected&&detail?.need.id===selected&&<article className="enterprise-governance-panel">
    <h2>{detail.need.clientName} · {detail.need.status}</h2>
    <p>{detail.need.serviceDescription}</p>
    <p>Canal: {detail.need.channel} · origem: {detail.need.originRef}</p>
    <p>Contato: {detail.need.contactName} · prazo: {detail.need.requestedDate}</p>
    {detail.need.orderId&&<button type="button" className="secondary" onClick={()=>onOpenOrder?.(detail.need.orderId!)}>Abrir OS vinculada</button>}
    <div className="form-row">
     {detail.need.status==='received'&&<button type="button" disabled={pending} onClick={()=>void command(selected,'start_analysis')}>Iniciar análise</button>}
     {detail.need.status==='in_analysis'&&<label>Justificativa da decisão<input value={reason} onChange={e=>setReason(e.target.value)} minLength={3}/></label>}
     {detail.need.status==='in_analysis'&&<button type="button" disabled={pending||reason.trim().length<3} onClick={()=>void command(selected,'approve',{reason})}>Aprovar (owner verificado)</button>}
     {detail.need.status==='in_analysis'&&<button type="button" disabled={pending||reason.trim().length<3} onClick={()=>void command(selected,'reject',{reason})}>Rejeitar (owner verificado)</button>}
     {detail.need.status==='approved'&&<label>Categoria da Ordem de Serviço
      <select value={orderCategory} onChange={e=>setOrderCategory(e.target.value)}>
       <option value="Serviços">Serviços</option><option value="Locação">Locação</option><option value="Transporte">Transporte</option><option value="Obra">Obra</option>
      </select>
     </label>}
     {detail.need.status==='approved'&&<button type="button" disabled={pending} onClick={()=>void command(selected,'convert',{orderId:uuid(),category:orderCategory})}>Converter em OS rascunho</button>}
     {detail.need.status==='converted'&&<label>Recurso do plano<input value={planRef} onChange={e=>setPlanRef(e.target.value)}/></label>}
     {detail.need.status==='converted'&&<label>Quantidade<input type="number" min="0.001" step="0.001" value={planQuantity} onChange={e=>setPlanQuantity(e.target.value)}/></label>}
     {detail.need.status==='converted'&&<label>Unidade<input value={planUnit} onChange={e=>setPlanUnit(e.target.value)}/></label>}
     {detail.need.status==='converted'&&<button type="button" disabled={pending||!planRef.trim()} onClick={()=>void command(selected,'set_plan',{lines:[{kind:'hours',resourceRef:planRef,quantityMilli:Math.round(Number(planQuantity)*1000),unit:planUnit}]})}>Registrar plano</button>}
     {detail.need.status==='converted'&&detail.need.orderId&&<button type="button" disabled={pending}
        onClick={()=>void (async()=>{
         setPending(true);setError('');setNotice('');
         try{
          const id=detail.need.orderId!;
          const current=await api<{order:{id:string;status:string;version:number}}>('/api/orders/'+encodeURIComponent(id));
          if(current.order.status!=='draft')throw Error('A OS deve estar em rascunho para autorização.');
          await api('/api/commands',{id,version:current.order.version,key:uuid(),command:'authorize'});
          setNotice('OS autorizada. Registre o plano e efetue a liberação.');
          refresh();
         }catch(e){setError(e instanceof Error?e.message:'Falha ao autorizar a OS.');}
         finally{setPending(false);}
        })()}>Autorizar OS antes da liberação</button>}
     {detail.need.status==='converted'&&<button type="button" disabled={pending||detail.planned.length===0} onClick={()=>void command(selected,'release')}>Liberar OS preparada</button>}
     {detail.need.status==='released'&&<label>Identidade do empregado<input value={employeeId} onChange={e=>setEmployeeId(e.target.value)}/></label>}
     {detail.need.status==='released'&&<label>ID do profissional cadastrado<input value={professionalId} onChange={e=>setProfessionalId(e.target.value)}/></label>}
     {detail.need.status==='released'&&<button type="button" disabled={pending||employeeId.trim().length<8||professionalId.trim().length<8}
      onClick={()=>void submit(root+'/employee-links',{commandKey:uuid(),employeeActorId:employeeId,professionalId},'Empregado vinculado ao profissional no contexto autorizado.')}>Vincular empregado</button>}
     {detail.need.status==='released'&&<button type="button" disabled={pending||employeeId.trim().length<8} onClick={()=>void command(selected,'assign',{employeeActorId:employeeId})}>Atribuir OS ao empregado</button>}
    </div>
    {detail.need.status==='executing'&&<div className="enterprise-governance-panel">
     <h3>Adicional operacional · imutável</h3>
     <label>Descrição<input value={additional} onChange={e=>setAdditional(e.target.value)}/></label>
     <label>Motivo<input value={reason} onChange={e=>setReason(e.target.value)}/></label>
     <label>Referência de evidência<input value={evidence} onChange={e=>setEvidence(e.target.value)}/></label>
     <button type="button" disabled={pending||additional.trim().length<3||reason.trim().length<3||evidence.trim().length<3}
      onClick={()=>void command(selected,'add_additional',{id:uuid(),description:additional,reason,evidenceRef:evidence})}>Registrar adicional (owner)</button>
    </div>}
    {detail.commercial&&<ServiceNeedsCommercialPanel key={detail.need.id} tenantId={tenantId} needId={selected} status={detail.need.status} commercial={detail.commercial} requests={detail.additionalRequests??[]} onRefresh={refresh}/>}
    {detail.fieldEvents&&<details><summary>Eventos operacionais registrados · {detail.fieldEvents.length}</summary>
     {detail.fieldEvents.map(ev=><p key={ev.id}><strong>{ev.eventType}</strong> · {ev.description} · {ev.actorId} · {ev.createdAt}{ev.quantityMilli!=null?' · '+(Number(ev.quantityMilli)/1000)+' '+(ev.unit??''):''}{ev.evidenceRef?' · '+ev.evidenceRef:''}</p>)}
    </details>}
    {detail.actual.length>0&&<details><summary>Comparação planejado × executado</summary>
     <table><thead><tr><th>Recurso</th><th>Planejado</th><th>Realizado</th><th>Diferença</th></tr></thead>
      <tbody>{Array.from(new Set([...detail.planned,...detail.actual].map(p=>p.kind+'|'+p.resourceRef+'|'+p.unit))).map(k=>{
       const [kind,ref,unit]=k.split('|');
       const planned=detail.planned.filter(p=>p.kind===kind&&p.resourceRef===ref&&p.unit===unit).reduce((n,p)=>n+Number(p.quantityMilli),0);
       const actual=detail.actual.filter(p=>p.kind===kind&&p.resourceRef===ref&&p.unit===unit).reduce((n,p)=>n+Number(p.quantityMilli),0);
       return <tr key={k}><td>{ref} · {kind}</td><td>{planned/1000} {unit}</td><td>{actual/1000} {unit}</td><td>{(actual-planned)/1000} {unit}</td></tr>;
      })}</tbody>
     </table>
    </details>}
    <details><summary>Trilha de auditoria · {detail.events.length} eventos</summary>
     <ol>{detail.events.map((ev,i)=><li key={i}><strong>{ev.event}</strong> · {ev.actorId} · {ev.createdAt}{ev.reason?' · '+ev.reason:''}</li>)}</ol>
    </details>
    <p>Planejado: {detail.planned.length} linhas · Realizado: {detail.actual.length} linhas · Atribuições: {detail.assignments.length}</p>
   </article>}
  </>}
 </section>;
}
