/** Advisory payment batch preflight. Final execution still rechecks under finance locks.
 * No synthetic approvals, cash, bank availability, or permissions are inferred.
 */
export function assessPaymentRunReadiness({run,items,periodClosed,rule,originReady}){
 const blockers=[],warnings=[];
 const add=(code,message)=>{if(!blockers.some(x=>x.code===code))blockers.push({code,message});};
 if(!run||run.status!=='prepared')add('RUN_NOT_PREPARED','O lote não está em situação preparada.');
 if(periodClosed)add('FINANCE_PERIOD_CLOSED','A competência do lote está encerrada.');
 if(!items.length)add('PAYMENT_RUN_EMPTY','O lote não possui obrigações.');
 let total=0n,stale=0,missing=0,collisions=0;
 for(const item of items){
  if(item.currentOutstandingScaled===null||item.currentOutstandingScaled===undefined){missing++;continue;}
  const amount=BigInt(String(item.amountScaled));
  const base=BigInt(String(item.baselineOutstandingScaled));
  const current=BigInt(String(item.currentOutstandingScaled));
  total+=amount;
  if(item.paymentId)collisions++;
  if(base!==current||amount>current||amount<=0n)stale++;
 }
 if(missing)add('PAYABLE_MISSING','Uma ou mais obrigações não estão disponíveis no escopo do proprietário.');
 if(stale)add('PAYMENT_RUN_STALE','Saldos alterados após a preparação; o lote deve ser recriado.');
 if(collisions)add('PAYMENT_RUN_COLLISION','Uma chave de pagamento do lote já foi utilizada.');
 if(rule?.enabled){
  if(!rule.valid)add('ACCOUNTING_RULE_INVALID','A regra de pagamento contábil possui contas inválidas, inativas ou de outra empresa.');
  else if(originReady?.missingCount>0)add('PAYABLE_ORIGIN_UNRECOGNIZED',
   'Uma ou mais obrigações não possuem reconhecimento contábil válido no passivo configurado.');
 }else warnings.push('Sem regra ativa de pagamento: o lote pode registrar baixas sem diário automático. Conferir política de escrituração.');
 warnings.push('A pré-validação é informativa. Executar revalida saldos, competência e regras sob bloqueio transacional.');
 warnings.push('Nenhuma transferência bancária será enviada e não há presunção de saldo disponível.');
 return {canExecute:blockers.length===0,blockers,warnings,
  summary:{itemCount:items.length,missingCount:missing,staleCount:stale,collisionCount:collisions,
   totalScaled:String(total),accountingPosting:rule?.enabled?(rule.valid?'enabled':'invalid'):'not_enabled'}};
}
