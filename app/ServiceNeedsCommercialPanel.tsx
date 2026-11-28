'use client';
import {useState,type FormEvent} from 'react';

export type Terms={id:string;pricingMode:'global'|'itemized'|'unpriced';globalSaleCents:string|null;paymentMethod:string|null;paymentTerms:string|null;maxQuantityMilli:string|null;maxFinancialCents:string|null;customerRules:string|null;createdAt:string};
export type Doc={id:string;documentType:string;reference:string;description:string;evidenceRef:string|null;createdAt:string};
export type Price={id:string;kind:string;itemRef:string;quantityMilli:string;unit:string;internalUnitCostCents:string;saleUnitPriceCents:string|null;supersedesId:string|null;superseded:boolean};
export type Request={id:string;kind:string;description:string;reason:string;quantityMilli:string;unit:string;evidenceRef:string;requestedByActorId:string;status:string;decisionReason:string|null};
export type Commercial={terms:Terms|null;history:Terms[];documents:Doc[];priceLines:Price[];totals:{estimatedInternalCostCents:string;itemizedSaleCents:string}};
const pricing=[{v:'global',label:'Preço global'},{v:'itemized',label:'Itens unitários'},{v:'unpriced',label:'A definir'}];
const kinds=[['labor','Mão de obra'],['vehicle','Veículo'],['equipment','Equipamento'],['material','Material'],['transport','Transporte'],['daily','Diária'],['hour','Hora'],['displacement','Deslocamento'],['service','Serviço'],['other','Outro']] as const;
const documents=[['proposal','Proposta'],['contract','Contrato'],['po','Pedido de Compra (PO)'],['rc','Requisição (RC)'],['client_order','Pedido do cliente'],['authorization','Autorização'],['client_attachment','Documento do cliente'],['other','Outro']] as const;
function cents(value:string):number|null{
 const m=value.trim().match(/^(\d{1,10})(?:,(\d{1,2}))?$/);
 if(!m)return null;
 const n=Number(m[1])*100+Number((m[2]??'').padEnd(2,'0'));
 return Number.isSafeInteger(n)&&n<=999999999999?n:null;
}
function milli(value:string):number|null{
 const m=value.trim().match(/^(\d{1,9})(?:[,.](\d{1,3}))?$/);
 if(!m)return null;
 const n=Number(m[1])*1000+Number((m[2]??'').padEnd(3,'0'));
 return Number.isSafeInteger(n)&&n>0&&n<=999999999999?n:null;
}
function money(value:string|null|undefined){if(value==null)return '—';const n=BigInt(value);return 'R$ '+(n/100n).toLocaleString('pt-BR')+','+(n%100n).toString().padStart(2,'0');}
const amount=(value:string)=>Number(value)/1000;
async function postCommand(tenantId:string,needId:string,command:string,data:Record<string,unknown>){
 const url='/api/enterprise/tenants/'+encodeURIComponent(tenantId)+'/service-needs/'+encodeURIComponent(needId)+'/commands';
 const response=await fetch(url,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({command,commandKey:crypto.randomUUID(),...data})});
 const result=await response.json() as {error?:string};
 if(!response.ok)throw Error(result.error??'A operação foi rejeitada.');
}
export default function ServiceNeedsCommercialPanel({tenantId,needId,status,commercial,requests,onRefresh}:{
 tenantId:string;needId:string;status:string;commercial:Commercial;requests:Request[];onRefresh:()=>void;
}){
 const [working,setWorking]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [pricingMode,setPricingMode]=useState<'global'|'itemized'|'unpriced'>(commercial.terms?.pricingMode??'unpriced');
 const [globalPrice,setGlobalPrice]=useState(''),[maxValue,setMaxValue]=useState('');
 const [maxQuantity,setMaxQuantity]=useState(''),[paymentMethod,setPaymentMethod]=useState(''),[paymentTerms,setPaymentTerms]=useState(''),[rules,setRules]=useState('');
 const [docType,setDocType]=useState('proposal'),[docRef,setDocRef]=useState(''),[docDescription,setDocDescription]=useState(''),[docEvidence,setDocEvidence]=useState('');
 const [kind,setKind]=useState('service'),[itemRef,setItemRef]=useState(''),[quantity,setQuantity]=useState('1'),[unit,setUnit]=useState('un'),[cost,setCost]=useState(''),[sale,setSale]=useState(''),[supersedesId,setSupersedesId]=useState<string|null>(null);
 const [decisionReason,setDecisionReason]=useState(''),[approvedCost,setApprovedCost]=useState(''),[approvedPrice,setApprovedPrice]=useState('');
 const editable=['received','in_analysis','approved','converted'].includes(status);
 const execute=async(command:string,data:Record<string,unknown>,success:string)=>{
  setWorking(true);setError('');setNotice('');
  try{await postCommand(tenantId,needId,command,data);setNotice(success);onRefresh();}
  catch(e){setError(e instanceof Error?e.message:'Falha ao persistir a decisão.');}
  finally{setWorking(false);}
 };
 const submitTerms=(e:FormEvent<HTMLFormElement>)=>{
  e.preventDefault();
  const price=pricingMode==='global'?cents(globalPrice):null;
  if(pricingMode==='global'&&price===null){setError('Informe preço global em reais, com até duas casas decimais.');return;}
  const limit=maxValue.trim()?cents(maxValue):null;
  const qty=maxQuantity.trim()?milli(maxQuantity):null;
  if((maxValue.trim()&&limit===null)||(maxQuantity.trim()&&qty===null)){setError('Limite comercial ou quantidade inválida.');return;}
  void execute('set_commercial_terms',{id:crypto.randomUUID(),pricingMode,globalSaleCents:price,paymentMethod:paymentMethod||null,paymentTerms:paymentTerms||null,maxQuantityMilli:qty,maxFinancialCents:limit,customerRules:rules||null},'Condições comerciais versionadas.');
 };
 const submitDocument=(e:FormEvent<HTMLFormElement>)=>{
  e.preventDefault();
  void execute('register_commercial_document',{id:crypto.randomUUID(),documentType:docType,reference:docRef,description:docDescription,evidenceRef:docEvidence||null},'Documento registrado na trilha comercial.');
 };
 const submitPrice=(e:FormEvent<HTMLFormElement>)=>{
  e.preventDefault();
  const q=milli(quantity),internal=cents(cost),selling=sale.trim()?cents(sale):null;
  if(q===null||internal===null||(sale.trim()&&selling===null)){setError('Quantidade, custo ou preço inválido. Use decimal com vírgula.');return;}
  if(commercial.terms?.pricingMode==='itemized'&&selling===null){setError('Este regime exige preço de venda unitário.');return;}
  void execute('register_price_line',{id:crypto.randomUUID(),supersedesId,kind,itemRef,quantityMilli:q,unit,internalUnitCostCents:internal,saleUnitPriceCents:selling},'Linha de custo e preço registrada sem alterar versões anteriores.');
 };
 const decide=(id:string,decision:'approved'|'rejected')=>{
  const internal=approvedCost.trim()?cents(approvedCost):null;
  const selling=approvedPrice.trim()?cents(approvedPrice):null;
  if(decisionReason.trim().length<3||(approvedCost.trim()&&internal===null)||(approvedPrice.trim()&&selling===null)){setError('Justificativa e valores válidos são obrigatórios.');return;}
  void execute('decide_additional',{requestId:id,decision,reason:decisionReason,approvedInternalCostCents:decision==='approved'?internal:null,approvedSalePriceCents:decision==='approved'?selling:null},'Decisão do adicional registrada com auditoria.');
 };
 const pending=requests.filter(x=>x.status==='pending');
 return <section className="enterprise-governance-panel" aria-label="Comercial e custos restritos">
  <h3>Comercial, composição econômica e autorização</h3>
  <p>Visibilidade restrita ao proprietário verificado. Registros anteriores não são substituídos silenciosamente. As referências documentais não equivalem a arquivos anexados.</p>
  {error&&<p role="alert" className="form-error">{error}</p>}
  {notice&&<p role="status" className="linked-info">{notice}</p>}
  <div className="form-row">
   <div><span>Regime</span><strong>{commercial.terms?.pricingMode??'Não definido'}</strong></div>
   <div><span>Venda global</span><strong>{money(commercial.terms?.globalSaleCents)}</strong></div>
   <div><span>Custo composto ativo</span><strong>{money(commercial.totals.estimatedInternalCostCents)}</strong></div>
   <div><span>Venda itemizada ativa</span><strong>{money(commercial.totals.itemizedSaleCents)}</strong></div>
  </div>
  {commercial.terms&&<p>Pagamento: {commercial.terms.paymentMethod??'não informado'} · Condições: {commercial.terms.paymentTerms??'não informadas'} · Limite financeiro: {money(commercial.terms.maxFinancialCents)} · Limite quantitativo: {commercial.terms.maxQuantityMilli?amount(commercial.terms.maxQuantityMilli):'—'} · Regras: {commercial.terms.customerRules??'não informadas'}</p>}
  {editable&&<details><summary>Versionar condições comerciais (preço global ou itemizado)</summary>
   <form onSubmit={submitTerms} className="enterprise-governance-panel">
    <div className="form-row">
     <label>Regime<select value={pricingMode} onChange={e=>setPricingMode(e.target.value as 'global'|'itemized'|'unpriced')}>{pricing.map(p=><option key={p.v} value={p.v}>{p.label}</option>)}</select></label>
     {pricingMode==='global'&&<label>Preço global, R$<input required placeholder="15000,00" value={globalPrice} onChange={e=>setGlobalPrice(e.target.value)}/></label>}
     <label>Forma de pagamento<input maxLength={100} value={paymentMethod} onChange={e=>setPaymentMethod(e.target.value)}/></label>
     <label>Condições de pagamento<input maxLength={500} value={paymentTerms} onChange={e=>setPaymentTerms(e.target.value)}/></label>
     <label>Limite financeiro, R$<input placeholder="50000,00" value={maxValue} onChange={e=>setMaxValue(e.target.value)}/></label>
     <label>Limite de quantidade<input placeholder="280" value={maxQuantity} onChange={e=>setMaxQuantity(e.target.value)}/></label>
    </div>
    <label>Regras comerciais do cliente<textarea maxLength={2000} value={rules} onChange={e=>setRules(e.target.value)}/></label>
    <button className="primary" disabled={working}>Registrar nova versão</button>
   </form>
  </details>}
  <details><summary>Documentos vinculados · {commercial.documents.length}</summary>
   {commercial.documents.map(d=><p key={d.id}><strong>{d.documentType} · {d.reference}</strong> — {d.description} {d.evidenceRef?' · '+d.evidenceRef:''}</p>)}
   {!commercial.documents.length&&<p>Sem documentação estruturada vinculada.</p>}
   {editable&&<form className="enterprise-governance-panel" onSubmit={submitDocument}>
    <div className="form-row">
     <label>Tipo<select value={docType} onChange={e=>setDocType(e.target.value)}>{documents.map(([v,label])=><option value={v} key={v}>{label}</option>)}</select></label>
     <label>Referência<input required minLength={2} value={docRef} onChange={e=>setDocRef(e.target.value)}/></label>
     <label>Descrição<input required minLength={3} value={docDescription} onChange={e=>setDocDescription(e.target.value)}/></label>
     <label>Arquivo ou evidência (referência)<input value={docEvidence} onChange={e=>setDocEvidence(e.target.value)}/></label>
    </div>
    <button disabled={working}>Vincular referência documental</button>
   </form>}
  </details>
  <details open><summary>Itens de custo interno e venda · {commercial.priceLines.filter(p=>!p.superseded).length} ativos</summary>
   <table><thead><tr><th>Recurso / serviço</th><th>Quantidade</th><th>Custo unit.</th><th>Venda unit.</th><th>Versão</th></tr></thead>
    <tbody>{commercial.priceLines.map(p=><tr key={p.id}><td>{p.itemRef} · {p.kind}</td><td>{amount(p.quantityMilli)} {p.unit}</td><td>{money(p.internalUnitCostCents)}</td><td>{money(p.saleUnitPriceCents)}</td><td>{p.superseded?'Substituída':editable?<button type="button" disabled={working} onClick={()=>{setSupersedesId(p.id);setKind(p.kind);setItemRef(p.itemRef);setQuantity(String(amount(p.quantityMilli)).replace('.',','));setUnit(p.unit);}}>Revisar</button>:'Vigente'}</td></tr>)}</tbody>
   </table>
   {editable&&<form className="enterprise-governance-panel" onSubmit={submitPrice}>
    <strong>{supersedesId?'Revisão de item existente':'Novo item econômico'}</strong>
    <div className="form-row">
     <label>Natureza<select value={kind} onChange={e=>setKind(e.target.value)}>{kinds.map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label>
     <label>Descrição do item<input required minLength={2} value={itemRef} onChange={e=>setItemRef(e.target.value)}/></label>
     <label>Quantidade<input required value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>
     <label>Unidade<input required value={unit} onChange={e=>setUnit(e.target.value)}/></label>
     <label>Custo interno unitário, R$<input required value={cost} onChange={e=>setCost(e.target.value)}/></label>
     <label>Venda unitária, R$<input value={sale} onChange={e=>setSale(e.target.value)}/></label>
    </div>
    <button disabled={working}>Salvar linha auditável</button>
    {supersedesId&&<button type="button" onClick={()=>setSupersedesId(null)}>Cancelar revisão</button>}
   </form>}
  </details>
  {pending.length>0&&<div className="enterprise-governance-panel">
   <h3>Solicitações de adicionais aguardando decisão · {pending.length}</h3>
   <label>Justificativa da decisão<input value={decisionReason} onChange={e=>setDecisionReason(e.target.value)}/></label>
   <div className="form-row">
    <label>Custo interno aprovado, R$<input value={approvedCost} onChange={e=>setApprovedCost(e.target.value)}/></label>
    <label>Preço adicional aprovado, R$<input value={approvedPrice} onChange={e=>setApprovedPrice(e.target.value)}/></label>
   </div>
   {pending.map(r=><div className="enterprise-governance-panel" key={r.id}>
    <p><strong>{r.kind} · {r.description}</strong> — {amount(r.quantityMilli)} {r.unit}</p>
    <p>Motivo: {r.reason} · Evidência: {r.evidenceRef}</p>
    <button type="button" disabled={working||decisionReason.trim().length<3} onClick={()=>decide(r.id,'approved')}>Aprovar adicional</button>
    <button type="button" disabled={working||decisionReason.trim().length<3} onClick={()=>decide(r.id,'rejected')}>Rejeitar</button>
   </div>)}
  </div>}
  {requests.length>pending.length&&<details><summary>Histórico das decisões · {requests.length-pending.length}</summary>
   {requests.filter(r=>r.status!=='pending').map(r=><p key={r.id}>{r.description} — {r.status} · {r.decisionReason}</p>)}
  </details>}
 </section>;
