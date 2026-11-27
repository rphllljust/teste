/** Audit-grade page export: no inferred posting, no floating-point money, CSV formula guarded. */
const fields=[
 ['reference','Pedido'],['supplier','Fornecedor'],['status','Situação do pedido'],
 ['phase','Etapa documental'],['orderScaled','Valor pedido em unidades escaladas'],
 ['payableScaled','Obrigação em unidades escaladas'],['paidScaled','Pago líquido em unidades escaladas'],
 ['outstandingScaled','Saldo em unidades escaladas'],['attributedScaled','Alocação de custo em unidades escaladas'],
 ['expectedOn','Entrega prevista'],['payableDueOn','Vencimento financeiro'],
 ['severity','Risco de prazo'],['flags','Ressalvas documentais'],['alerts','Alertas de prazo']
];
function cell(value){
 const raw=Array.isArray(value)?value.join(' | '):String(value??'');
 // Excel/LibreOffice formula injection applies after leading whitespace as well.
 const safe=/^[\s\uFEFF]*[=+\-@]/u.test(raw)?"'"+raw:raw;
 return '"'+safe.replaceAll('"','""')+'"';
}
export function serializeProcurePortfolioCsv(items){
 const data=[fields.map(([,label])=>cell(label)).join(';')];
 for(const item of items)data.push(fields.map(([key])=>cell(item[key])).join(';'));
 return '\uFEFF'+data.join('\r\n')+'\r\n';
}
