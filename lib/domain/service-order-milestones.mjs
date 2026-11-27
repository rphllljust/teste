/** Governs non-financial OS milestone evidence. A milestone is NOT a
 * command to authorize, complete, bill or legally accept a service order.
 */
export const milestoneDescriptors=Object.freeze([
 {code:'site_readiness',label:'Frente de trabalho preparada',module:'Ordens de serviço'},
 {code:'resources_verified',label:'Equipe e recursos conferidos',module:'Resource Planning Board'},
 {code:'safety_reviewed',label:'Verificação de segurança registrada',module:'Ordens de serviço'},
 {code:'execution_inspected',label:'Execução inspecionada',module:'Execução'},
 {code:'quality_checked',label:'Controle interno de qualidade registrado',module:'Execução'},
 {code:'handover_recorded',label:'Entrega documental registrada',module:'Dossiês empresariais'},
]);
const preparatory=new Set(['planned','authorized','executing']);
export const allowedMilestoneCodes=status=>{
 if(preparatory.has(status))return milestoneDescriptors.filter(d=>d.code!=='handover_recorded').map(d=>d.code);
 if(status==='completed')return ['quality_checked','handover_recorded'];
 return [];
};
export function summarizeMilestoneEvents(events){
 const active=new Map();
 for(const event of [...events].sort((a,b)=>Number(a.sequence)-Number(b.sequence))){
  if(event.kind==='record')active.set(event.checkpoint,event);
  else if(event.kind==='revoke'&&active.get(event.checkpoint)?.id===event.reversesId)
   active.delete(event.checkpoint);
 }
 return milestoneDescriptors.map(d=>({...d,active:active.has(d.code),
  currentId:active.get(d.code)?.id??null}));
}
