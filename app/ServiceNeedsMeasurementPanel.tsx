'use client';
import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {formatServiceCentsBRL} from '../lib/domain/service-money.mjs';

type Snapshot={
 pricingMode:string;baseSaleCents:string;approvedAdditionalSaleCents:string;
 authorizedCeilingCents:string;measuredCents:string;unpricedAdditionalCount:number;
 contractRef:string|null;proposalRef:string|null;poRef:string|null;rcRef:string|null;
 clientName:string;planRevision:number;reportId:string;paymentTerms:string|null;
};
type Measurement={
 measurementId:string;reportId:string;description:string;status:'draft'|'approved'|'billed';
 version:number;amountCents:number;preparedByActorId:string;preparedAt:string;
 commercialSnapshot:Snapshot;approvedByActorId:string|null;approvalReason:string|null;approvedAt:string|null;
 invoiceId:string|null;invoiceAmountCents:number|null;dueDate:string|null;
 receivableId:string|null;receivableAmountCents:number|null;settledCents:string;
};
type Settlement={id:string;kind:'receipt'|'reversal';amountCents:number;effectiveDate:string;reference:string;createdAt:string;reversesId:string|null;reversed:boolean};
type Dossier={status:string;orderId:string|null;measurements:Measurement[];canSettleReceivable:boolean;settlements:Settlement[]};
/** API uses 1/100 BRL; native AR/GL uses 1/10,000. Never display cents as reais. */
const money=(cents:number|string)=>formatServiceCentsBRL(cents);
function cents(text:string){
 const m=text.trim().match(/^(\d{1,10})(?:[,.](\d{1,2}))?$/);
 if(!m)return null;
 const amount=Number(m[1])*100+Number((m[2]??'').padEnd(2,'0'));
 return Number.isSafeInteger(amount)&&amount>0&&amount<=21474836?amount:null;
}
const base=(tenantId:string,needId:string)=>'/api/enterprise/tenants/'+encodeURIComponent(tenantId)+'/service-needs/'+encodeURIComponent(needId)+'/measurements';
export default function ServiceNeedsMeasurementPanel({tenantId,needId,onRefresh}:{
 tenantId:string;needId:string;onRefresh:()=>void;
}){
 const [data,setData]=useState<Dossier|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [pending,setPending]=useState(false),[reload,setReload]=useState(0);
 const [amount,setAmount]=useState(''),[description,setDescription]=useState(''),[reason,setReason]=useState('');
 const [dueDate,setDueDate]=useState('');
 const [receiptAmount,setReceiptAmount]=useState(''),[receiptReference,setReceiptReference]=useState('');
 const [receiptDate,setReceiptDate]=useState(()=>new Date().toISOString().slice(0,10));
 const refresh=useCallback(()=>{setReload(v=>v+1);onRefresh();},[onRefresh]);
 useEffect(()=>{
  const ac=new AbortController();
  void fetch(base(tenantId,needId),{credentials:'same-origin',cache:'no-store',signal:ac.signal})
   .then(async r=>{
    const x=await r.json() as Dossier&{error?:string};
    if(!r.ok)throw Error(x.error??'Dossiê financeiro indisponível.');
    if(!ac.signal.aborted){setData(x);setError('');}
   }).catch(e=>{if(!ac.signal.aborted)setError(e instanceof Error?e.message:'Consulta indisponível.');});
  return()=>ac.abort();
 },[tenantId,needId,reload]);
 async function command(url:string,payload:object,success:string){
  setPending(true);setError('');setNotice('');
  try{
   const r=await fetch(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
   const d=await r.json() as {error?:string};
   if(!r.ok)throw Error(d.error??'Transição financeira recusada.');
   setNotice(success);refresh();
  }catch(e){setError(e instanceof Error?e.message:'Falha ao processar o comando.');}
  finally{setPending(false);}
 }
 function prepare(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const amountCents=cents(amount);
  if(amountCents===null){setError('Valor inválido. Informe reais e centavos, por exemplo 1500,00.');return;}
  void command(base(tenantId,needId),{
   action:'prepare',id:crypto.randomUUID(),commandKey:crypto.randomUUID(),description:description.trim(),amountCents,
  },'Medição criada em rascunho. Outro controlador deve conferi-la e aprová-la.');
 }
 function collect(e:FormEvent<HTMLFormElement>,receivableId:string){
  e.preventDefault();const amountCents=cents(receiptAmount);
  if(amountCents===null){setError('Valor de recebimento inválido.');return;}
  void command('/api/finance/receivables/settlements',{
   receivableId,amount:String(amountCents*100),effectiveDate:receiptDate,
   reference:receiptReference.trim(),commandKey:crypto.randomUUID(),
  },'Recebimento aplicado ao título; saldo e razão devem ser conciliados no Financeiro.');
 }
 const current=data?.measurements[0];
 const canPrepare=data?.status==='completed'&&data.measurements.length===0;
 return <section className="enterprise-governance-panel" aria-label="Medição, faturamento e recebíveis da necessidade">
  <h3>Da OS concluída ao financeiro</h3>
  <p>Relatório aceito → medição auditável → aprovação de outro controlador → cobrança e título a receber.
   Esta jornada não transmite nota fiscal, não compensa pagamentos automaticamente e não dispensa o fechamento contábil.</p>
  {error&&<p role="alert" className="form-error">{error}</p>}
  {notice&&<p role="status">{notice}</p>}
  {!data&&!error&&<p>Consultando situação da medição…</p>}
  {data?.status!=='completed'&&<p>A conferência operacional precisa ser aceita antes de criar uma medição financeira.</p>}
  {canPrepare&&<form className="enterprise-governance-panel" onSubmit={prepare}>
   <h4>Preparar medição vinculada ao aceite</h4>
   <label>Descrição da medição<input value={description} required minLength={10} maxLength={1000}
    onChange={e=>setDescription(e.target.value)} placeholder="Serviços realizados conforme OS e relatório de campo aceito"/></label>
   <label>Valor medido (R$)<input value={amount} required onChange={e=>setAmount(e.target.value)}
    placeholder="1500,00" inputMode="decimal"/></label>
   <p>O servidor recalcula e valida o teto considerando contrato, PO, itens comerciais e adicionais aprovados. Medições individuais ficam limitadas a R$ 214.748,36 pelo livro financeiro atual.
    Um valor maior que o autorizado é recusado.</p>
   <button type="submit" disabled={pending||description.trim().length<10||cents(amount)===null}>Preparar medição</button>
  </form>}
  {current&&<div className="enterprise-governance-panel">
   <h4>Medição · {current.status==='draft'?'Aguardando aprovação':current.status==='approved'?'Aprovada — apta a faturamento':'Faturada'}</h4>
   <p><strong>{current.description}</strong></p>
   <p>Valor medido: <strong>{money(current.amountCents)}</strong> · limite comercial congelado: {money(current.commercialSnapshot.authorizedCeilingCents)}</p>
   <p>Preço-base: {money(current.commercialSnapshot.baseSaleCents)} · adicionais comercialmente precificados: {money(current.commercialSnapshot.approvedAdditionalSaleCents)}</p>
   {current.commercialSnapshot.unpricedAdditionalCount>0&&<p>Existem {current.commercialSnapshot.unpricedAdditionalCount} adicionais autorizados sem preço de venda: não foram adicionados automaticamente ao valor faturável.</p>}
   <p>Origem: relatório {current.reportId} · plano v{current.commercialSnapshot.planRevision} · {current.commercialSnapshot.pricingMode} · PO {current.commercialSnapshot.poRef??'não informada'}</p>
   <p>Preparada por {current.preparedByActorId} em {current.preparedAt}.</p>
   {current.status==='draft'&&<div className="enterprise-governance-panel">
    <p>Controle de quatro olhos: a pessoa que preparou esta medição não pode aprová-la.</p>
    <label>Justificativa da aprovação<input required minLength={3} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}
     placeholder="Relatório e valor conferidos contra autorização comercial"/></label>
    <button type="button" disabled={pending||reason.trim().length<3} className="primary" onClick={()=>void command(base(tenantId,needId),{
     action:'approve',measurementId:current.measurementId,commandKey:crypto.randomUUID(),expectedVersion:1,reason:reason.trim(),
    },'Medição aprovada. Faturamento requer comando específico.')}>Aprovar medição (segundo controlador)</button>
   </div>}
   {current.approvedByActorId&&<p>Aprovada por {current.approvedByActorId} · {current.approvalReason} · {current.approvedAt}</p>}
   {current.status==='approved'&&<div className="enterprise-governance-panel">
    <label>Data de vencimento da cobrança<input type="date" required value={dueDate} onChange={e=>setDueDate(e.target.value)}/></label>
    <p>O faturamento gera documento de cobrança e conta a receber em uma única transação, com lançamento contábil automático somente quando houver regra válida configurada.</p>
    <button type="button" className="primary" disabled={pending||!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)}
     onClick={()=>void command('/api/commands',{
      id:current.measurementId,version:current.version,key:crypto.randomUUID(),command:'invoice',dueDate,
     },'Faturamento realizado com vínculo para conta a receber.')}>Faturar medição aprovada</button>
   </div>}
   {current.invoiceId&&<div className="enterprise-governance-panel">
    <p><strong>Documento de cobrança:</strong> {current.invoiceId} · {money(current.invoiceAmountCents??0)} · vencimento {current.dueDate}</p>
    <p><strong>Conta a receber:</strong> {current.receivableId} · total {money(current.receivableAmountCents??0)} · liquidado {money(current.settledCents)}</p>
    <p>Saldo em aberto: {money(BigInt(String(current.receivableAmountCents??0))-BigInt(current.settledCents)>0n?
       (BigInt(String(current.receivableAmountCents??0))-BigInt(current.settledCents)).toString():'0')}</p>
    {data?.canSettleReceivable&&current.receivableId&&
     Number(current.receivableAmountCents??0)>Number(current.settledCents)&&
     <form className="enterprise-governance-panel" onSubmit={e=>collect(e,current.receivableId!)}>
      <h4>Registrar recebimento comprovado</h4>
      <p>Disponível somente à identidade titular do razão financeiro da OS. Não equivale a conciliação bancária nem a quitação presumida.</p>
      <label>Valor efetivamente recebido (R$)<input required inputMode="decimal" value={receiptAmount}
       onChange={e=>setReceiptAmount(e.target.value)} placeholder="1000,00"/></label>
      <label>Data de crédito<input required type="date" value={receiptDate} onChange={e=>setReceiptDate(e.target.value)}/></label>
      <label>Referência bancária / comprovante<input required minLength={1} maxLength={160}
       value={receiptReference} onChange={e=>setReceiptReference(e.target.value)}/></label>
      <button type="submit" className="primary" disabled={pending||cents(receiptAmount)===null||!receiptReference.trim()||!receiptDate}>
       Registrar baixa financeira
      </button>
     </form>}
    {!data?.canSettleReceivable&&<p>O recebimento é registrado no módulo financeiro pela identidade titular do razão contábil desta OS; o segundo controlador permanece com acesso de consulta.</p>}
    {data?.canSettleReceivable&&data.settlements.length>0&&<details>
     <summary>Histórico imutável de recebimentos e estornos · {data.settlements.length}</summary>
     {data.settlements.map(s=><div key={s.id} className="enterprise-governance-panel">
      <p><strong>{s.kind==='receipt'?'Recebimento':'Estorno'}:</strong> {money(s.amountCents)} · {s.effectiveDate} · {s.reference}
       {s.reversed?' · já estornado':''}</p>
      {s.kind==='receipt'&&!s.reversed&&<button type="button" disabled={pending}
       onClick={()=>void command('/api/finance/receivables/settlements/'+encodeURIComponent(s.id)+'/reverse',{
        commandKey:crypto.randomUUID(),effectiveDate:receiptDate,reference:'Estorno autorizado: '+s.reference.slice(0,130),
       },'Estorno solicitado; a origem e a competência são validadas pelo razão contábil.')}>Estornar lançamento incorreto</button>}
     </div>)}
    </details>}
   </div>}
  </div>}
  <button type="button" disabled={pending} onClick={()=>setReload(x=>x+1)}>Atualizar medição e recebíveis</button>
 </section>;
}
