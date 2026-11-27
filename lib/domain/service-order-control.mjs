/**
 * Evidence-only Operational Control Plane for one Service Order.
 * Independent records never imply release of server-side lifecycle commands.
 * Monetary values use exact scaled BigInt strings. No cash or margin invented.
 */
const integer=value=>{
 const raw=String(value??'0');
 if(!/^-?\d+$/.test(raw))throw Error('INVALID_SERVICE_ORDER_SCALED_VALUE');
 return BigInt(raw);
};
const count=value=>{
 const n=Number(value??0);
 if(!Number.isSafeInteger(n)||n<0)throw Error('INVALID_SERVICE_ORDER_COUNT');
 return n;
};
const utcDate=(value)=>{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
 const ms=Date.parse(value+'T00:00:00.000Z');
 return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===value?ms:null;
};
/**
 * "Critical" describes an evidence gap, not a regulatory conclusion
 * or a command authorization. No record is ever changed by this function.
 */
export function deriveServiceOrderControl(source,{asOf=new Date().toISOString().slice(0,10)}={}){
 const today=utcDate(asOf);
 if(today===null)throw Error('INVALID_SERVICE_ORDER_ASOF_DATE');
 const status=String(source.status);
 const activeAllocations=count(source.activeAllocations);
 const activeExecutions=count(source.activeExecutions);
 const unmeasuredExecutions=count(source.unmeasuredExecutions);
 const measurements=count(source.measurements);
 const measurementSubmitted=count(source.measurementSubmitted);
 const approvedUnbilled=count(source.approvedUnbilled);
 const invoices=count(source.invoices);
 const invoicesWithoutReceivable=count(source.invoicesWithoutReceivable);
 const invoicedWithoutPosting=count(source.invoicedWithoutPosting);
 const unmatchedReceipts=count(source.unmatchedReceipts);
 const billed=integer(source.billedScaled),settled=integer(source.settledScaled);
 const cost=integer(source.costScaled);
 const outstanding=billed-settled;
 const alerts=[];
 const add=(code,severity,module,message)=>alerts.push({code,severity,module,message});
 const open=!['completed','cancelled'].includes(status);
 const due=utcDate(source.dueDate);
 if(open&&due!==null&&due<today)add('ORDER_OVERDUE','warning','Ordens de serviço','Prazo previsto da OS vencido.');
 if(['planned','authorized','executing'].includes(status)&&activeAllocations===0)
  add('RESOURCE_PLAN_UNVERIFIED','info','Resource Planning Board','Nenhuma alocação ativa registrada nesta OS; não equivale a indisponibilidade do recurso.');
 if(status==='executing'&&activeExecutions===0)
  add('EXECUTION_NOT_REPORTED','info','Execução','OS em execução sem apontamento ativo confirmado.');
 if(status==='completed'&&activeExecutions===0)
  add('COMPLETED_WITHOUT_EXECUTION','warning','Execução','OS concluída sem apontamento ativo de execução.');
 if(status==='completed'&&unmeasuredExecutions>0)
  add('EXECUTION_UNMEASURED','warning','Medições','Há apontamentos ativos sem medição não cancelada vinculada.');
 if(measurementSubmitted>0)
  add('MEASUREMENT_PENDING_REVIEW','info','Medições','Há medição submetida sem aprovação evidenciada.');
 if(approvedUnbilled>0)
  add('APPROVED_UNBILLED','warning','Faturamento','Há medições aprovadas ainda sem fatura vinculada.');
 if(invoicesWithoutReceivable>0)
  add('INVOICE_WITHOUT_RECEIVABLE','warning','Financeiro','Há faturas sem título a receber vinculado.');
 if(invoicedWithoutPosting>0)
  add('INVOICE_POSTING_UNVERIFIED','info','Contabilidade','Há faturas sem lançamento contábil publicado e não estornado comprovado.');
 if(unmatchedReceipts>0)
  add('RECEIPT_BANK_MATCH_UNVERIFIED','info','Caixa e conciliação','Existem recebimentos sem conciliação bancária vigente comprovada.');
 if(outstanding<0n)
  add('RECEIPTS_EXCEED_INVOICES','warning','Financeiro','Recebimentos líquidos excedem os valores faturados; validar a origem.');
 if(cost<0n)
  add('NEGATIVE_ALLOCATED_COST','warning','Controladoria','Estornos de custos atribuídos superam as atribuições.');
 if(['draft','prepared'].includes(status)&&activeExecutions>0)
  add('PREPARATION_WITH_EXECUTION','warning','Ordens de serviço','OS em preparação possui execução registrada; revisar histórico.');
 if(status==='cancelled'&&(activeExecutions>0||invoices>0))
  add('CANCELLED_WITH_EVIDENCE','info','Dossiês empresariais','OS cancelada mantém registros históricos; nenhuma baixa é presumida.');
 let focus='Ordens de serviço';
 if(['planned','authorized'].includes(status))focus='Resource Planning Board';
 else if(status==='executing')focus='Execução';
 else if(status==='completed')focus=unmeasuredExecutions>0?'Medições':
  approvedUnbilled>0?'Faturamento':outstanding>0n?'Financeiro':'Dossiês empresariais';
 return {
  status,focus,
  alerts,
  counts:{activeAllocations,activeExecutions,unmeasuredExecutions,measurements,
   measurementSubmitted,approvedUnbilled,invoices,invoicesWithoutReceivable,
   invoicedWithoutPosting,unmatchedReceipts},
  financial:{billedScaled:String(billed),settledScaled:String(settled),
   openReceivableScaled:String(outstanding),attributedCostScaled:String(cost),
   partialContributionScaled:String(billed-cost)},
  overdue:open&&due!==null&&due<today,
  asOf,
 };
}
