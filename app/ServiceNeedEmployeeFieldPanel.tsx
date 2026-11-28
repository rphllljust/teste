'use client';
import {useState,type FormEvent} from 'react';
import ServiceEvidenceAttachmentsPanel from './ServiceEvidenceAttachmentsPanel';

type Plan={kind:string;resourceRef:string;quantityMilli:string;unit:string};
const items=[['team','Equipe'],['vehicle','Veículo'],['equipment','Equipamento'],['material','Material'],['hours','Horas'],['quantity','Quantidade']] as const;
const fieldTypes=[['observation','Observação'],['occurrence','Ocorrência'],['pause','Paralisação'],['resume','Retomada'],['odometer','Odômetro / km'],['hourmeter','Horímetro'],['photo','Fotografia'],['document','Documento']] as const;
const additions=[['labor','Mão de obra'],['vehicle','Veículo'],['equipment','Equipamento'],['material','Material'],['transport','Transporte'],['daily','Diária'],['hour','Hora'],['displacement','Deslocamento'],['service','Serviço adicional'],['other','Outro']] as const;
function milli(value:string):number|null{
 const m=value.trim().match(/^(\d{1,9})(?:[,.](\d{1,3}))?$/);
 if(!m)return null;
 const result=Number(m[1])*1000+Number((m[2]??'').padEnd(3,'0'));
 return Number.isSafeInteger(result)&&result>0?result:null;
}
function nonNegativeMilli(value:string):number|null{
 const m=value.trim().match(/^(\d{1,9})(?:[,.](\d{1,3}))?$/);
 if(!m)return null;
 const result=Number(m[1])*1000+Number((m[2]??'').padEnd(3,'0'));
 return Number.isSafeInteger(result)?result:null;
}
export default function ServiceNeedEmployeeFieldPanel({tenantId,needId,assignmentId,planned,onRefresh}:{
 tenantId:string;needId:string;assignmentId:string;planned:Plan[];onRefresh:()=>void;
}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [kind,setKind]=useState('hours'),[resourceRef,setResourceRef]=useState(''),[quantity,setQuantity]=useState('1'),[unit,setUnit]=useState('h');
 const [fieldType,setFieldType]=useState('observation'),[description,setDescription]=useState(''),[fieldQuantity,setFieldQuantity]=useState(''),[fieldUnit,setFieldUnit]=useState(''),[evidenceRef,setEvidenceRef]=useState('');
 const [additionalKind,setAdditionalKind]=useState('hour'),[additionalDescription,setAdditionalDescription]=useState(''),[reason,setReason]=useState(''),[additionalQuantity,setAdditionalQuantity]=useState('1'),[additionalUnit,setAdditionalUnit]=useState('h'),[additionalEvidence,setAdditionalEvidence]=useState('');
 const [reportSummary,setReportSummary]=useState(''),[reportEvidence,setReportEvidence]=useState('');
 const send=async(command:string,data:Record<string,unknown>)=>{
  setBusy(true);setError('');setNotice('');
  try{
   const response=await fetch('/api/enterprise/tenants/'+encodeURIComponent(tenantId)+'/service-needs/'+encodeURIComponent(needId)+'/commands',{
    method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({command,commandKey:crypto.randomUUID(),...data})
   });
   const result=await response.json() as {error?:string};
   if(!response.ok)throw Error(result.error??'Não foi possível registrar a operação.');
   setNotice('Registro salvo com responsável, data e trilha de auditoria.');onRefresh();
  }catch(e){setError(e instanceof Error?e.message:'Falha ao registrar.');}
  finally{setBusy(false);}
 };
 const actual=(e:FormEvent<HTMLFormElement>)=>{
  e.preventDefault();const q=milli(quantity);
  if(q===null){setError('Quantidade inválida. Utilize até três casas decimais.');return;}
  void send('record_actual',{id:crypto.randomUUID(),assignmentId,line:{kind,resourceRef,quantityMilli:q,unit}});
 };
 const event=(e:FormEvent<HTMLFormElement>)=>{
  e.preventDefault();
  const meter=['odometer','hourmeter'].includes(fieldType);
  const q=meter?nonNegativeMilli(fieldQuantity):null;
  if((meter&&(!fieldUnit.trim()||q===null))||(['photo','document'].includes(fieldType)&&evidenceRef.trim().length<3)){
   setError('Informe medidor e unidade ou referência documental, conforme o tipo de evento.');return;
  }
  void send('record_field_event',{id:crypto.randomUUID(),assignmentId,eventType:fieldType,description,quantityMilli:q,unit:meter?fieldUnit:null,evidenceRef:evidenceRef||null});
 };
 const extra=(e:FormEvent<HTMLFormElement>)=>{
  e.preventDefault();const q=milli(additionalQuantity);
  if(q===null){setError('Quantidade adicional inválida.');return;}
  void send('request_additional',{id:crypto.randomUUID(),assignmentId,kind:additionalKind,description:additionalDescription,reason,quantityMilli:q,unit:additionalUnit,evidenceRef:additionalEvidence});
 };
 const finish=(e:FormEvent<HTMLFormElement>)=>{
  e.preventDefault();
  if(reportSummary.trim().length<10){setError('Descreva o trabalho concluído com pelo menos 10 caracteres.');return;}
  void send('submit_work_report',{id:crypto.randomUUID(),assignmentId,summary:reportSummary.trim(),evidenceRef:reportEvidence||null});
 };
 return <section className="enterprise-governance-panel" aria-label="Apontamentos de execução">
  <h4>Execução de campo · registros verificáveis</h4>
  <p>O apontamento não modifica o plano original. Custos, margens e preços comerciais não são disponibilizados ao empregado.</p>
  {error&&<p role="alert" className="form-error">{error}</p>}
  {notice&&<p role="status" className="linked-info">{notice}</p>}
  <details><summary>Plano recebido · {planned.length} itens</summary>
   {planned.length?planned.map((p,i)=><p key={i}>{p.resourceRef} · {p.kind} · {Number(p.quantityMilli)/1000} {p.unit}</p>):<p>Sem instruções estruturadas cadastradas.</p>}
  </details>
  <details open><summary>Apontar quantidade realmente executada</summary>
   <form onSubmit={actual} className="enterprise-governance-panel">
    <div className="form-row">
     <label>Tipo<select value={kind} onChange={e=>setKind(e.target.value)}>{items.map(([v,label])=><option value={v} key={v}>{label}</option>)}</select></label>
     <label>Equipamento, equipe ou recurso<input value={resourceRef} onChange={e=>setResourceRef(e.target.value)} required minLength={1} maxLength={200}/></label>
     <label>Quantidade real<input value={quantity} onChange={e=>setQuantity(e.target.value)} required placeholder="10,000"/></label>
     <label>Unidade<input value={unit} onChange={e=>setUnit(e.target.value)} required maxLength={20}/></label>
    </div>
    <button className="primary" disabled={busy}>Registrar execução real</button>
   </form>
  </details>
  <ServiceEvidenceAttachmentsPanel tenantId={tenantId} needId={needId} category="field" onUploaded={ref=>{setEvidenceRef(ref);setAdditionalEvidence(ref);setReportEvidence(ref);}}/>
  <details><summary>Registrar ocorrência, paralisação, retomada, fotografia ou medidor</summary>
   <form onSubmit={event} className="enterprise-governance-panel">
    <div className="form-row">
     <label>Evento<select value={fieldType} onChange={e=>setFieldType(e.target.value)}>{fieldTypes.map(([v,label])=><option value={v} key={v}>{label}</option>)}</select></label>
     <label>Descrição<input required minLength={3} maxLength={1000} value={description} onChange={e=>setDescription(e.target.value)}/></label>
     {['odometer','hourmeter'].includes(fieldType)&&<>
      <label>Leitura<input required value={fieldQuantity} onChange={e=>setFieldQuantity(e.target.value)} placeholder="8500,125"/></label>
      <label>Unidade<input required value={fieldUnit} onChange={e=>setFieldUnit(e.target.value)} placeholder="km / h"/></label>
     </>}
     <label>Referência de foto, documento ou evidência<input required={['photo','document'].includes(fieldType)} value={evidenceRef} onChange={e=>setEvidenceRef(e.target.value)} maxLength={500}/></label>
    </div>
    <p>Referências são metadados; o arquivo precisa estar armazenado em repositório documental autorizado.</p>
    <button disabled={busy}>Registrar evento com data e autoria</button>
   </form>
  </details>
  <details><summary>Solicitar recurso ou serviço adicional</summary>
   <form onSubmit={extra} className="enterprise-governance-panel">
    <div className="form-row">
     <label>Tipo<select value={additionalKind} onChange={e=>setAdditionalKind(e.target.value)}>{additions.map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label>
     <label>Recurso solicitado<input required minLength={3} value={additionalDescription} onChange={e=>setAdditionalDescription(e.target.value)}/></label>
     <label>Quantidade<input required value={additionalQuantity} onChange={e=>setAdditionalQuantity(e.target.value)}/></label>
     <label>Unidade<input required value={additionalUnit} onChange={e=>setAdditionalUnit(e.target.value)}/></label>
     <label>Motivo<input required minLength={3} value={reason} onChange={e=>setReason(e.target.value)}/></label>
     <label>Referência da evidência<input required minLength={3} value={additionalEvidence} onChange={e=>setAdditionalEvidence(e.target.value)}/></label>
    </div>
    <button disabled={busy}>Enviar para autorização administrativa</button>
    <p>A solicitação não concede aprovação, gasto ou faturamento automaticamente. Apenas um proprietário verificado decide.</p>
   </form>
  </details>
  <details><summary>Solicitar conferência e conclusão da OS</summary>
   <form onSubmit={finish} className="enterprise-governance-panel">
    <p>A solicitação exige execução apontada e ausência de paralisações ou adicionais pendentes. Apenas um controlador verificado aceita a conclusão.</p>
    <label>Relatório do serviço executado<textarea required minLength={10} maxLength={2000} rows={4}
     value={reportSummary} onChange={e=>setReportSummary(e.target.value)} placeholder="Descreva os serviços realizados, diferenças e condições finais."/></label>
    <label>Referência de evidência operacional (opcional conforme a OS)<input maxLength={500}
     value={reportEvidence} onChange={e=>setReportEvidence(e.target.value)} placeholder="cisne-file:..."/></label>
    <button type="submit" className="primary" disabled={busy||reportSummary.trim().length<10}>Enviar relatório para aceite administrativo</button>
   </form>
  </details>
 </section>;
}
