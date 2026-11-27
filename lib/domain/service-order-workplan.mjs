/** OS workplan controls: activity checkpoints are not verified execution, AP or GL. */
const integer=v=>{const raw=String(v??'0');if(!/^(0|[1-9][0-9]*)$/.test(raw))throw Error('INVALID_WORKPLAN_MONEY');return BigInt(raw);};
export function projectWorkPlan(packages,actualCostScaled){
 const active=packages.filter(p=>p.state!=='cancelled');
 const plannedCost=active.reduce((n,p)=>n+integer(p.plannedCostScaled),0n);
 const plannedHours=active.reduce((n,p)=>n+integer(p.plannedHoursScaled),0n);
 const actual=integer(actualCostScaled);
 const done=active.filter(p=>p.state==='done').length;
 const overdue=active.filter(p=>p.state!=='done'&&p.overdue).length;
 const blocked=active.filter(p=>p.blocked).length;
 const unbudgeted=plannedCost===0n&&actual>0n;
 return {packages:packages.length,active:active.length,done,overdue,blocked,
  plannedCostScaled:String(plannedCost),plannedHoursScaled:String(plannedHours),
  actualAttributedCostScaled:String(actual),varianceScaled:String(plannedCost-actual),
  varianceAvailable:plannedCost>0n,unbudgeted,
  completionRatePercent:active.length?Math.floor(done*100/active.length):null};
}
export function nextWorkPackageState({current,command,orderState,dependencyState,hasActiveDependents=false}){
 if(orderState==='cancelled')return {ok:false,code:'ORDER_CANCELLED'};
 if(current==='done'||current==='cancelled')return {ok:false,code:'PACKAGE_TERMINAL'};
 if(command==='ready')return current==='draft'?{ok:true,state:'ready'}:{ok:false,code:'INVALID_STATE'};
 if(command==='start'){
  if(current!=='ready')return {ok:false,code:'INVALID_STATE'};
  if(!['authorized','executing'].includes(orderState))return {ok:false,code:'ORDER_NOT_AUTHORIZED'};
  if(dependencyState!=null&&dependencyState!=='done')return {ok:false,code:'DEPENDENCY_UNFINISHED'};
  return {ok:true,state:'in_progress'};
 }
 if(command==='complete'){
  if(current!=='in_progress')return {ok:false,code:'INVALID_STATE'};
  if(orderState!=='executing')return {ok:false,code:'ORDER_NOT_EXECUTING'};
  if(dependencyState!=null&&dependencyState!=='done')return {ok:false,code:'DEPENDENCY_UNFINISHED'};
  return {ok:true,state:'done'};
 }
 if(command==='cancel'){
  if(hasActiveDependents)return {ok:false,code:'DEPENDENT_PACKAGES_OPEN'};
  return {ok:true,state:'cancelled'};
 }
 return {ok:false,code:'INVALID_COMMAND'};
}
