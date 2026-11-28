/* eslint-disable @typescript-eslint/no-explicit-any -- dynamic SQL rows and JSON test payloads */
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {Pool} from 'pg';
import {closeDatabase,database} from '../../db/raw';
import {hashPersonalPassword,verifyPersonalLogin} from '../../lib/api/personal-login.mjs';
import {issuePersonalStagingSession,validateStagingSession,issueStagingSession,CISNE_STAGING_COOKIE} from '../../lib/api/staging-session.mjs';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {GET as listNeeds,POST as postNeed} from '../../app/api/enterprise/tenants/[id]/service-needs/route';
import {GET as needDetail} from '../../app/api/enterprise/tenants/[id]/service-needs/[needId]/route';
import {POST as command,GET as fieldPreflight} from '../../app/api/enterprise/tenants/[id]/service-needs/[needId]/commands/route';
import {POST as linkEmployee} from '../../app/api/enterprise/tenants/[id]/employee-links/route';
import {GET as inboxGet} from '../../app/api/enterprise/tenants/[id]/employee-inbox/route';
import {POST as orderCommand} from '../../app/api/commands/route';
import {GET as orderDetail} from '../../app/api/orders/[id]/route';
import {GET as orderList} from '../../app/api/orders/route';
import {serviceGoReadiness} from '../../lib/application/service-go-readiness';
import {getPeriodCloseReadiness} from '../../lib/application/finance';
import {POST as evidencePost,GET as evidenceList} from '../../app/api/enterprise/tenants/[id]/service-needs/[needId]/attachments/route';
import {GET as evidenceFile} from '../../app/api/enterprise/tenants/[id]/service-needs/[needId]/attachments/[fileId]/route';
import {GET as measurementGet,POST as measurementPost} from '../../app/api/enterprise/tenants/[id]/service-needs/[needId]/measurements/route';
import {GET as controlTowerGet} from '../../app/api/enterprise/tenants/[id]/service-needs/control-tower/route';
import {POST as recordReceipt} from '../../app/api/finance/receivables/settlements/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)throw new Error('Service need integration requires disposable PostgreSQL');
const u=new URL(process.env.DATABASE_URL);
if(!['127.0.0.1','localhost'].includes(u.hostname)||!['/cisne_test','/cisne_ci'].includes(u.pathname))throw new Error('NO-GO: refuses non-disposable database');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:4});
// Synthetic fictional identities only.
const abrahim=randomUUID(),rafael=randomUUID(),admin=randomUUID(),employee=randomUUID(),employee2=randomUUID(),outsider=randomUUID(),otherOwner=randomUUID();
const tenantA=randomUUID(),tenantB=randomUUID(),professional=randomUUID(),professional2=randomUUID();
const now=new Date().toISOString();
const tp=(t:string)=>({params:Promise.resolve({id:t})});
const np=(t:string,n:string)=>({params:Promise.resolve({id:t,needId:n})});
const post=(who:string,body:unknown)=>setTestIdentity(new Request('http://localhost/x',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),who);
const get=(who:string)=>setTestIdentity(new Request('http://localhost/x'),who);
const pdfEvidence=Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n');
const putEvidence=(who:string,tenant:string,need:string,category:'field'|'commercial',bytes:Buffer=pdfEvidence,mime='application/pdf')=>
 evidencePost(setTestIdentity(new Request('http://localhost/upload',{
  method:'POST',
  headers:{'content-type':mime,'x-cisne-evidence-category':category,'x-cisne-filename':encodeURIComponent('evidence.pdf')},
  body:new Uint8Array(bytes)
 }),who),np(tenant,need));
const evidenceParams=(tenant:string,need:string,fileId:string)=>({params:Promise.resolve({id:tenant,needId:need,fileId})});
const measurePost=(who:string,t:string,n:string,body:Record<string,unknown>)=>measurementPost(post(who,body),np(t,n));
const cmd=async(who:string,t:string,n:string,body:Record<string,unknown>)=>{const r=await command(post(who,{commandKey:randomUUID(),...body}),np(t,n));return {status:r.status,body:await r.json() as Record<string,any>};};
const needBody=(id:string)=>({id,commandKey:randomUUID(),channel:'whatsapp',originRef:'ficticio-0001',clientName:'Cliente Ficticio Ltda',contactName:'Contato Ficticio',
 contactEmail:'contato@exemplo.invalid',serviceDescription:'Manutenção preventiva fictícia',location:'Local ficticio A',requestedDate:'2026-12-10',priority:'high',
 proposalRef:'PROP-F-1',contractRef:'CT-F-1',poRef:'PO-F-1',rcRef:'RC-F-1',commercialTerms:'30 dias fictícios',commercialLimitCents:500000});

async function seed(){
 for(const [t,s] of [[tenantA,'a'],[tenantB,'b']])await pool.query("INSERT INTO enterprise_tenants(id,slug,name,created_by,created_at) VALUES($1,$2,$3,$4,$5)",[t,'svc-'+s+'-'+t.slice(0,8),'Empresa Ficticia '+s,abrahim,now]);
 const m=(t:string,a:string,r:string)=>pool.query("INSERT INTO enterprise_tenant_memberships(tenant_id,actor_id,role,created_at) VALUES($1,$2,$3,$4)",[t,a,r,now]);
 await m(tenantA,abrahim,'owner');await m(tenantA,rafael,'owner');await m(tenantA,admin,'admin');await m(tenantA,employee,'operator');await m(tenantA,employee2,'operator');
 await m(tenantB,otherOwner,'owner');
 await pool.query("UPDATE cisne_erp_owner_declarations SET identity_actor_id=$1,identity_state='verified' WHERE owner_key='abrahim'",[abrahim]);
 await pool.query("UPDATE cisne_erp_owner_declarations SET identity_actor_id=$1,identity_state='verified' WHERE owner_key='rafael'",[rafael]);
 for(const [p,reg] of [[professional,'F-1'],[professional2,'F-2']])
  await pool.query("INSERT INTO professionals(id,owner_id,name,registration,specialty,department,status,created_at,updated_at) VALUES($1,$2,'Profissional Ficticio',$3,'Field','Ops','active',$4,$4)",[p,abrahim,reg+p.slice(0,6),now]);
 // Completely synthetic but fully posted AR/revenue chart rules for both controllers.
 for(const actor of [abrahim,rafael]){
  const debit=randomUUID(),credit=randomUUID();
  await pool.query("INSERT INTO chart_accounts(id,code,name,type,active,created_at,actor_id,request_hash) VALUES($1,$2,'Accounts receivable','asset',1,$3,$4,$5)",
   [debit,'AR-'+actor.slice(0,8),now,actor,'synthetic-gl-ar']);
  await pool.query("INSERT INTO chart_accounts(id,code,name,type,active,created_at,actor_id,request_hash) VALUES($1,$2,'Service revenue','revenue',1,$3,$4,$5)",
   [credit,'RV-'+actor.slice(0,8),now,actor,'synthetic-gl-revenue']);
  await pool.query("INSERT INTO accounting_posting_rules(id,actor_id,source_type,debit_account_id,credit_account_id,active,row_version,created_at,updated_at) VALUES($1,$2,'invoice_billing',$3,$4,1,1,$5,$5)",
   [randomUUID(),actor,debit,credit,now]);
  const bank=randomUUID();
  await pool.query("INSERT INTO chart_accounts(id,code,name,type,active,created_at,actor_id,request_hash) VALUES($1,$2,'Operating bank','asset',1,$3,$4,$5)",
   [bank,'BANK-'+actor.slice(0,8),now,actor,'synthetic-gl-bank']);
  await pool.query("INSERT INTO accounting_posting_rules(id,actor_id,source_type,debit_account_id,credit_account_id,active,row_version,created_at,updated_at) VALUES($1,$2,'receivable_receipt',$3,$4,1,1,$5,$5)",
   [randomUUID(),actor,bank,debit,now]);
 }

}
after(async()=>{
 await pool.query("UPDATE cisne_erp_owner_declarations SET identity_actor_id=NULL,identity_state='unlinked'");
 await closeDatabase();await pool.end();
});

test('migration 0034 is registered and recorded',async()=>{
 const r=await pool.query("SELECT id FROM _cisne_schema_migrations WHERE id IN ('0034_service_need_to_execution','0035_service_ops_enterprise_commercial_field','0036_cisne_individual_auth_and_evidence','0037_service_plan_revision_and_acceptance','0038_service_measurement_finance_bridge') ORDER BY id");
 assert.deepEqual(r.rows.map(x=>x.id),['0034_service_need_to_execution','0035_service_ops_enterprise_commercial_field','0036_cisne_individual_auth_and_evidence','0037_service_plan_revision_and_acceptance','0038_service_measurement_finance_bridge']);
});

test('full journey: intake, owner decision, draft OS, plan, release, assignment, receipt, execution, additionals',async()=>{
 await seed();
 // Three distinct personal credentials in disposable PostgreSQL; never provision real actors.
 const secret='Test-Only-Highly-Random-Session-Key-For-Full-Journey'.repeat(2);
 const personalEnv={...process.env,RAILWAY_ENVIRONMENT_NAME:'staging',CISNE_STAGING_AUTH_MODE:'individual',
  CISNE_STAGING_SESSION_SECRET:secret,CISNE_STAGING_ACTOR_ID:'shared-disabled-actor'};
 for(const [actor,handle] of [[abrahim,'test-owner-one'],[rafael,'test-owner-two'],[employee,'test-employee']] as const){
  const phrase='Synthetic-Only-Private-Password-2026-'+handle;
  const encoded=await hashPersonalPassword(phrase);
  await pool.query('INSERT INTO cisne_login_accounts(actor_id,login_handle,salt,password_hash) VALUES($1,$2,$3,$4)',[actor,handle,encoded.salt,encoded.hash]);
  const identified=await database().transaction(q=>verifyPersonalLogin(q,handle,phrase));
  assert.equal(identified.ok,true,'verified individual must authenticate');
  assert.equal(identified.actorId,actor,'password must never swap actor identities');
  const personal=issuePersonalStagingSession(actor,secret);
  const cookieRequest=new Request('https://cisne-web-staging-staging.up.railway.app/api/crm',{headers:{cookie:CISNE_STAGING_COOKIE+'='+personal}});
  assert.equal(validateStagingSession(cookieRequest,personalEnv),actor);
 }
 const shared=issueStagingSession('shared-disabled-actor',secret);
 assert.equal(validateStagingSession(new Request('https://cisne-web-staging-staging.up.railway.app',{headers:{cookie:CISNE_STAGING_COOKIE+'='+shared}}),personalEnv),null);
 assert.equal((await database().transaction(q=>verifyPersonalLogin(q,'test-owner-one','Invalid-But-Long-Password-For-Access-0000'))).ok,false);
 for(let i=0;i<5;i++)assert.equal((await database().transaction(q=>verifyPersonalLogin(q,'unknown-account','Invalid-But-Long-Password-For-Access-0000'))).ok,false);
 const fp=createHash('sha256').update('cisne-login/v1:unknown-account').digest('hex');
 const locked=await pool.query('SELECT failures,locked_until FROM cisne_login_attempts WHERE login_fingerprint=$1',[fp]);
 assert.equal(locked.rows[0].failures,5);
 assert.ok(new Date(locked.rows[0].locked_until).getTime()>Date.now(),'persistent lockout prevents guessing');

 const needId=randomUUID();
 // (1) intake with channel/refs/terms
 assert.equal((await postNeed(post(admin,needBody(randomUUID())),tp(tenantA))).status,403,'only verified controllers may register needs');
 const r=await postNeed(post(abrahim,needBody(needId)),tp(tenantA));assert.equal(r.status,201,JSON.stringify(await r.clone().json()));
 const body=needBody(needId);
 const replayed=await postNeed(post(abrahim,{...body,commandKey:(await pool.query('SELECT command_key FROM svc_need_events WHERE need_id=$1',[needId])).rows[0].command_key}),tp(tenantA));
 assert.equal(replayed.status,201);assert.equal((await replayed.json() as any).replayed,true);
 const q=await listNeeds(get(abrahim),tp(tenantA));const items=(await q.json() as any).items;
 assert.equal(items.length,1);assert.equal(items[0].channel,'whatsapp');assert.equal(items[0].poRef,'PO-F-1');assert.equal(items[0].commercialLimitCents,500000);
 // (2) analysis and decision: admin may analyze but never approve; employee/outsider cannot
 assert.equal((await cmd(admin,tenantA,needId,{command:'start_analysis'})).status,403);
 assert.equal((await cmd(abrahim,tenantA,needId,{command:'start_analysis'})).status,200);
 assert.equal((await cmd(admin,tenantA,needId,{command:'approve',reason:'tentativa de admin'})).status,403);
 assert.equal((await cmd(employee,tenantA,needId,{command:'approve',reason:'tentativa de empregado'})).status,403);
 assert.equal((await cmd(outsider,tenantA,needId,{command:'approve',reason:'fora do tenant'})).status,404);
 assert.equal((await cmd(otherOwner,tenantA,needId,{command:'approve',reason:'owner de outro tenant'})).status,404);
 assert.equal((await cmd(abrahim,tenantA,needId,{command:'convert',orderId:randomUUID()})).status,409,'cannot convert before approval');
 const approvalKey=randomUUID();
 const approval={command:'approve',commandKey:approvalKey,reason:'Escopo e limite conferidos',financials:{estimatedCostCents:120000,marginBps:2500}};
 assert.equal((await cmd(rafael,tenantA,needId,approval)).status,200);
 const approvalReplay=await cmd(rafael,tenantA,needId,approval);
 assert.equal(approvalReplay.status,200,'same command key must replay without executing again');
 assert.equal(approvalReplay.body.replayed,true);
 assert.equal((await cmd(rafael,tenantA,needId,{command:'reject',commandKey:approvalKey,reason:'outra operacao'})).status,409,'same key cannot authorize a different command');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM svc_need_events WHERE tenant_id=$1 AND command_key=$2',[tenantA,approvalKey])).rows[0].n,1,'replay cannot duplicate audit');
 // Commercial snapshot: global sale, identifiable PO/RC, detailed operational inputs
 // Durable commercial upload; a field employee cannot read prices or these files.
 const commercialUpload=await putEvidence(abrahim,tenantA,needId,'commercial');
 assert.equal(commercialUpload.status,201,JSON.stringify(await commercialUpload.clone().json()));
 const commercialRef=(await commercialUpload.json() as any).file.evidenceRef as string;
 assert.match(commercialRef,/^cisne-file:[a-f0-9-]{36}$/);
 const commercialId=commercialRef.slice('cisne-file:'.length);
 assert.equal((await evidenceFile(get(rafael),evidenceParams(tenantA,needId,commercialId))).status,200,'verified co-owner download');
 assert.equal((await evidenceFile(get(employee),evidenceParams(tenantA,needId,commercialId))).status,404,'employee cannot download commercial file');
 assert.equal((await evidenceFile(get(otherOwner),evidenceParams(tenantA,needId,commercialId))).status,404,'cross-tenant commercial file denied');
 const docs=(await evidenceList(get(rafael),np(tenantA,needId))).status;
 assert.equal(docs,400,'evidence listing requires explicit category');
 assert.equal((await putEvidence(abrahim,tenantA,needId,'commercial',Buffer.from('not-a-pdf'))).status,415,'reject MIME spoofing');
 await assert.rejects(()=>pool.query('DELETE FROM svc_evidence_files WHERE id=$1',[commercialId]),/APPEND_ONLY/);
 const termsId=randomUUID();
 const commercial={command:'set_commercial_terms',id:termsId,pricingMode:'global',globalSaleCents:495000,paymentMethod:'transferencia',paymentTerms:'30 dias',maxFinancialCents:700000,maxQuantityMilli:280000,customerRules:'Escopo global com transporte e material'};
 assert.equal((await cmd(abrahim,tenantA,needId,commercial)).status,200);
 assert.equal((await cmd(rafael,tenantA,needId,{command:'register_commercial_document',id:randomUUID(),documentType:'po',reference:'PO-EX-001',description:'Pedido de compra de exemplo',evidenceRef:'arquivo-po-ficticio'})).status,200);
 assert.equal((await cmd(rafael,tenantA,needId,{command:'register_commercial_document',id:randomUUID(),documentType:'rc',reference:'RC-EX-001',description:'Requisição vinculada de exemplo'})).status,200);
 const priceId=randomUUID();
 assert.equal((await cmd(abrahim,tenantA,needId,{command:'register_price_line',id:priceId,kind:'material',itemRef:'Cascalho fictício',quantityMilli:280000,unit:'m3',internalUnitCostCents:1500,saleUnitPriceCents:null})).status,200);
 const commercialDetail=await (await needDetail(get(abrahim),np(tenantA,needId))).json() as any;
 assert.equal(commercialDetail.commercial.terms.pricingMode,'global');
 assert.equal(commercialDetail.commercial.documents.length,2);
 assert.equal(commercialDetail.commercial.totals.estimatedInternalCostCents,'420000');
 assert.equal(commercialDetail.commercial.priceLines[0].quantityMilli,'280000');

 // (3) conversion creates only a DRAFT order
 const orderId=randomUUID();
 assert.equal((await cmd(admin,tenantA,needId,{command:'convert',orderId})).status,403,'admin cannot become owner of OS');
 const conv=await cmd(abrahim,tenantA,needId,{command:'convert',orderId});assert.equal(conv.status,200);assert.equal(conv.body.orderStatus,'draft');
 assert.equal((await pool.query('SELECT status FROM service_orders WHERE id=$1',[orderId])).rows[0].status,'draft');
 // (4) planning separate from actuals; (5) explicit release before assignment
 assert.equal((await cmd(abrahim,tenantA,needId,{command:'assign',employeeActorId:employee})).status,409,'no assignment before release');
 assert.equal((await cmd(abrahim,tenantA,needId,{command:'release'})).status,409,'release needs a plan');
 const plan=await cmd(abrahim,tenantA,needId,{command:'set_plan',lines:[
  {kind:'team',resourceRef:'Equipe A',quantityMilli:2000,unit:'pessoa'},{kind:'vehicle',resourceRef:'Veículo ficticio V1',quantityMilli:1000,unit:'un'},
  {kind:'material',resourceRef:'Material M1',quantityMilli:5500,unit:'kg'},{kind:'hours',resourceRef:'Horas campo',quantityMilli:16000,unit:'h'}]});
 assert.equal(plan.status,200);
 assert.equal((await cmd(abrahim,tenantA,needId,{command:'release'})).status,409,'release requires canonical OS authorization');
 const auth=await orderCommand(post(rafael,{id:orderId,version:1,key:randomUUID(),command:'authorize'}));
 assert.equal(auth.status,201,JSON.stringify(await auth.clone().json()));
 assert.equal((await orderDetail(get(rafael),{params:Promise.resolve({id:orderId})})).status,200,'co-owner sees order');
 assert.equal((await orderDetail(get(admin),{params:Promise.resolve({id:orderId})})).status,404,'admin not owner of linked OS');
 const otherOwnerWorklist=await (await orderList(get(rafael))).json() as any;
 assert.ok(otherOwnerWorklist.items.some((x:any)=>x.id===orderId),'verified co-owner sees linked order in canonical worklist');
 assert.equal((await cmd(admin,tenantA,needId,{command:'release'})).status,403,'admin cannot release');
 assert.equal((await cmd(abrahim,tenantA,needId,{command:'release'})).status,200);
 const bypass=await orderCommand(post(abrahim,{id:orderId,version:2,key:randomUUID(),command:'start'}));
 assert.equal(bypass.status,409,'canonical start cannot bypass employee receipt');
 assert.equal((await cmd(abrahim,tenantA,needId,{command:'set_plan',lines:[{kind:'team',resourceRef:'x',quantityMilli:1,unit:'p'}]})).status,409,'plan frozen');
 assert.equal((await cmd(abrahim,tenantA,needId,{...commercial,id:randomUUID()})).status,409,'commercial terms frozen after release');
 assert.equal((await cmd(abrahim,tenantA,needId,{command:'register_price_line',id:randomUUID(),kind:'material',itemRef:'Outro material',quantityMilli:1000,unit:'kg',internalUnitCostCents:1000})).status,409,'price revision forbidden after release');
 await assert.rejects(()=>pool.query('DELETE FROM svc_plan_lines WHERE need_id=$1',[needId]),/APPEND_ONLY/);
 // (6) authenticated link, assignment, inbox events
 assert.equal((await cmd(abrahim,tenantA,needId,{command:'assign',employeeActorId:employee})).status,409,'unlinked employee');
 const lk=(who:string,actorId:string,prof:string)=>linkEmployee(post(who,{commandKey:randomUUID(),employeeActorId:actorId,professionalId:prof}),tp(tenantA));
 assert.equal((await lk(admin,employee,professional)).status,403);
 assert.equal((await lk(abrahim,outsider,professional)).status,404,'link target must be tenant member');
 assert.equal((await lk(rafael,employee,professional)).status,201);
 const readiness=await database().transaction(q=>serviceGoReadiness(q,tenantA,abrahim,'individual'));
 assert.equal(readiness.status,'READY_FOR_PERSONAL_UAT','all three synthetic actors are configured and linked');
 assert.equal(readiness.findings.every(x=>x.ok),true);
 const disabledMode=await database().transaction(q=>serviceGoReadiness(q,tenantA,abrahim,'shared'));
 assert.equal(disabledMode.status,'NO_GO','shared actor mode must fail an integral GO');
 assert.equal((await database().transaction(q=>serviceGoReadiness(q,tenantA,admin,'individual')).catch(()=>null)),null,'admins cannot self-approve GO');
 assert.equal((await lk(rafael,employee,professional2)).status,409);
 const asg=await cmd(rafael,tenantA,needId,{command:'assign',employeeActorId:employee});assert.equal(asg.status,200);
 const assignmentId=asg.body.assignmentId as string;
 let inbox=await (await inboxGet(get(employee),tp(tenantA))).json() as any;
 assert.deepEqual(inbox.items[0].events,['assigned']);
 assert.ok(!('commercialLimitCents' in inbox.items[0])&&!('commercialTerms' in inbox.items[0]));
 assert.equal((await (await inboxGet(get(employee2),tp(tenantA))).json() as any).items.length,0,'other employee sees nothing');
 // (7) execution only after receipt, only by the assigned employee
 assert.equal((await cmd(employee,tenantA,needId,{command:'start_execution',assignmentId})).status,409,'not received yet');
 assert.equal((await cmd(employee,tenantA,needId,{command:'mark_received',assignmentId})).status,409,'must view first');
 assert.equal((await cmd(employee2,tenantA,needId,{command:'mark_viewed',assignmentId})).status,404,'not own assignment');
 assert.equal((await cmd(abrahim,tenantA,needId,{command:'mark_received',assignmentId})).status,404,'owner cannot fake receipt');
 assert.equal((await cmd(employee,tenantA,needId,{command:'mark_viewed',assignmentId})).status,200);
 assert.equal((await cmd(employee,tenantA,needId,{command:'mark_received',assignmentId})).status,200);
 assert.equal((await cmd(employee2,tenantA,needId,{command:'start_execution',assignmentId})).status,404);
 const started=await cmd(employee,tenantA,needId,{command:'start_execution',assignmentId});
 assert.equal(started.status,200);
 assert.equal(started.body.orderStatus,'executing');
 const fieldUpload=await putEvidence(employee,tenantA,needId,'field');
 assert.equal(fieldUpload.status,201,JSON.stringify(await fieldUpload.clone().json()));
 const fieldId=((await fieldUpload.json() as any).file.evidenceRef as string).slice('cisne-file:'.length);
 const bytes=await evidenceFile(get(employee),evidenceParams(tenantA,needId,fieldId));
 assert.equal(bytes.status,200);
 assert.deepEqual(Buffer.from(await bytes.arrayBuffer()),pdfEvidence);
 assert.equal((await evidenceFile(get(employee2),evidenceParams(tenantA,needId,fieldId))).status,404,'unassigned employee cannot access evidence');
 const ownerListing=await evidenceList(setTestIdentity(new Request('http://localhost/list?category=field'),abrahim),np(tenantA,needId));
 assert.equal(ownerListing.status,200);
 assert.equal((await ownerListing.json() as any).items.length,1);
 assert.deepEqual((await pool.query('SELECT status,version FROM service_orders WHERE id=$1',[orderId])).rows[0],{status:'executing',version:3});
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM order_events WHERE order_id=$1 AND command='start'",[orderId])).rows[0].n,1);
 inbox=await (await inboxGet(get(employee),tp(tenantA))).json();
 assert.deepEqual(inbox.items[0].events,['assigned','viewed','received']);assert.equal(inbox.items[0].status,'executing');
 // Field events cannot rewrite the plan; pausing prohibits new production quantities.
 const field=(eventType:string,more:Record<string,unknown>={})=>cmd(employee,tenantA,needId,{command:'record_field_event',id:randomUUID(),assignmentId,eventType,description:'Observação de campo auditada',...more});
 const fieldState=(who:string,assignment:string)=>fieldPreflight(setTestIdentity(new Request(
  'http://localhost/api/enterprise/tenants/'+tenantA+'/service-needs/'+needId+
  '/commands?assignmentId='+assignment),who),np(tenantA,needId));
 assert.equal((await fieldState(outsider,assignmentId)).status,404,'outsider cannot inspect assigned field state');
 assert.equal((await fieldState(employee2,assignmentId)).status,404,'colleague cannot see another assignment');
 assert.equal((await fieldState(employee,'bogus')).status,400);
 assert.equal((await fieldState(employee,assignmentId)).status,200);
 assert.equal((await field('pause')).status,200);
 const paused=await fieldState(employee,assignmentId);
 const pausedStatus=await paused.json() as {paused:boolean;canRecordProduction:boolean};
 assert.equal(pausedStatus.paused,true);
 assert.equal(pausedStatus.canRecordProduction,false);
 assert.equal((await field('odometer',{quantityMilli:18500200,unit:'km'})).status,409,'meter cannot accrue during pause');
 assert.equal((await field('occurrence')).status,200,'safety incidents can be captured while paused');
 assert.equal((await cmd(employee,tenantA,needId,{command:'submit_work_report',id:randomUUID(),assignmentId,summary:'Relatório indevido em paralisação'})).status,409);
 assert.equal((await cmd(employee,tenantA,needId,{command:'record_actual',assignmentId,id:randomUUID(),line:{kind:'hours',resourceRef:'Horas campo',quantityMilli:1000,unit:'h'}})).status,409,'no work during pause');
 assert.equal((await field('pause')).status,409,'cannot pause twice');
 assert.equal((await field('resume')).status,200);
 assert.equal((await (await fieldState(employee,assignmentId)).json() as {canRecordProduction:boolean}).canRecordProduction,true);
 assert.equal((await field('odometer',{quantityMilli:18500200,unit:'km'})).status,200);
 assert.equal((await field('odometer',{quantityMilli:18500000,unit:'km'})).status,409,'odometer cannot decrease');
 assert.equal((await field('photo',{evidenceRef:'foto-operacao-ficticia'})).status,200);
 // actuals stay separate from plan
 const act=await cmd(employee,tenantA,needId,{command:'record_actual',assignmentId,id:randomUUID(),line:{kind:'hours',resourceRef:'Horas campo',quantityMilli:17500,unit:'h'}});
 assert.equal(act.status,200);
 // Employee requests an additional without authorizing itself or viewing pricing.
 const requestId=randomUUID();
 assert.equal((await cmd(employee,tenantA,needId,{command:'request_additional',id:requestId,assignmentId,kind:'hour',description:'Duas horas extras',reason:'Espera técnica',quantityMilli:2000,unit:'h',evidenceRef:'boletim-ficticio-002'})).status,200);
 assert.equal((await cmd(admin,tenantA,needId,{command:'decide_additional',requestId,decision:'approved',reason:'Sem poderes'})).status,403);
 assert.equal((await cmd(rafael,tenantA,needId,{command:'decide_additional',requestId,decision:'approved',reason:'Autorizado após evidência',approvedInternalCostCents:2800,approvedSalePriceCents:4900})).status,200);
 assert.equal((await cmd(rafael,tenantA,needId,{command:'decide_additional',requestId,decision:'approved',reason:'Duplica decisão'})).status,409);
 const decision=await pool.query('SELECT decision,approved_internal_cost_cents,approved_sale_price_cents FROM svc_additional_decisions WHERE request_id=$1',[requestId]);
 assert.equal(decision.rows[0].decision,'approved');
 assert.equal(Number(decision.rows[0].approved_internal_cost_cents),2800);
 // Financial ceiling includes all approved additions; a rejected request has no price.
 const overLimitId=randomUUID();
 assert.equal((await cmd(employee,tenantA,needId,{command:'request_additional',id:overLimitId,assignmentId,kind:'hour',description:'Horas extras acima do limite',reason:'Tempo não previsto no escopo',quantityMilli:3000,unit:'h',evidenceRef:'boletim-teto-ficticio'})).status,200);
 assert.equal((await cmd(rafael,tenantA,needId,{command:'decide_additional',requestId:overLimitId,decision:'approved',reason:'Tenta exceder orçamento',approvedInternalCostCents:0,approvedSalePriceCents:100000})).status,409,'commercial ceiling includes base global price and past accepted extras');
 assert.equal((await cmd(abrahim,tenantA,needId,{command:'decide_additional',requestId:overLimitId,decision:'rejected',reason:'Custo comercial ultrapassaria o limite',approvedSalePriceCents:100000})).status,400,'rejected additions cannot record approved values');
 assert.equal((await cmd(abrahim,tenantA,needId,{command:'decide_additional',requestId:overLimitId,decision:'rejected',reason:'Limite comercial impede a aprovação'})).status,200);

 // (8) additionals: append-only, owner-authorized, reason and evidence, history preserved
 const add1=randomUUID(),add2=randomUUID();
 const mk=(who:string,id:string,sup:string|null)=>cmd(who,tenantA,needId,{command:'add_additional',id,supersedesId:sup,description:'Escavação extra fictícia',reason:'Obstrução não prevista',evidenceRef:'foto-ficticia-001'});
 assert.equal((await mk(employee,add1,null)).status,403,'employee cannot self-authorize');
 assert.equal((await mk(abrahim,add1,null)).status,200);
 assert.equal((await mk(rafael,add2,add1)).status,200);
 await assert.rejects(()=>pool.query("UPDATE svc_additionals SET reason='x' WHERE id=$1",[add1]),/APPEND_ONLY/);
 await assert.rejects(()=>pool.query('DELETE FROM svc_additionals WHERE id=$1',[add1]),/APPEND_ONLY/);
 await assert.rejects(()=>pool.query('UPDATE svc_actual_lines SET quantity_milli=1'),/APPEND_ONLY/);
 await assert.rejects(()=>pool.query('DELETE FROM svc_inbox_events'),/APPEND_ONLY/);
 await assert.rejects(()=>pool.query('UPDATE svc_need_events SET actor_id=$1 WHERE need_id=$2',['forged',needId]),/APPEND_ONLY/);

 // (9) Real field closure: employee request, owner return, correction, owner approval.
 // Generic complete/cancel cannot bypass the independently audited service-need flow.
 assert.equal((await orderCommand(post(abrahim,{id:orderId,version:3,key:randomUUID(),command:'complete'}))).status,409);
 assert.equal((await orderCommand(post(rafael,{id:orderId,version:3,key:randomUUID(),command:'cancel'}))).status,409);
 assert.equal((await cmd(rafael,tenantA,needId,{command:'review_work_report',reportId:randomUUID(),decision:'accepted',reason:'Sem relatório'})).status,409);
 assert.equal((await cmd(employee2,tenantA,needId,{command:'submit_work_report',id:randomUUID(),assignmentId,summary:'Tentativa de terceiro sem atribuição'})).status,404);
 const report1=randomUUID(),report2=randomUUID();
 assert.equal((await cmd(employee,tenantA,needId,{command:'submit_work_report',id:randomUUID(),assignmentId,summary:'Evidência de outra categoria',evidenceRef:commercialRef})).status,409);
 assert.equal((await cmd(employee,tenantA,needId,{command:'submit_work_report',id:report1,assignmentId,summary:'Atividades concluídas, sujeito à conferência do plano e evidências.',evidenceRef:'cisne-file:'+fieldId})).status,200);
 assert.equal((await cmd(employee,tenantA,needId,{command:'record_actual',id:randomUUID(),assignmentId,line:{kind:'hours',resourceRef:'Horas campo',quantityMilli:1000,unit:'h'}})).status,409,'new actual locked during owner review');
 assert.equal((await cmd(admin,tenantA,needId,{command:'review_work_report',reportId:report1,decision:'accepted',reason:'Sem permissão'})).status,403);
 const duringReview=await (await inboxGet(get(employee),tp(tenantA))).json() as any;
 assert.equal(duringReview.items[0].status,'review_pending');
 assert.equal(duringReview.items[0].workReview.status,'pending');
 assert.equal((await cmd(abrahim,tenantA,needId,{command:'review_work_report',reportId:report1,decision:'returned',reason:'Conferir duas horas de deslocamento'})).status,200);
 assert.equal((await pool.query('SELECT status FROM service_orders WHERE id=$1',[orderId])).rows[0].status,'executing');
 assert.equal((await cmd(rafael,tenantA,needId,{command:'review_work_report',reportId:report1,decision:'accepted',reason:'Tentar aceitar devolvido'})).status,409);
 assert.equal((await cmd(employee,tenantA,needId,{command:'record_actual',id:randomUUID(),assignmentId,line:{kind:'hours',resourceRef:'Horas campo',quantityMilli:2000,unit:'h'}})).status,200);
 assert.equal((await cmd(employee,tenantA,needId,{command:'submit_work_report',id:report2,assignmentId,summary:'Relatório corrigido com duas horas adicionais de deslocamento.',evidenceRef:'cisne-file:'+fieldId})).status,200);
 assert.equal((await cmd(rafael,tenantA,needId,{command:'review_work_report',reportId:report1,decision:'accepted',reason:'Relatório antigo'})).status,409,'cannot review an outdated report');
 assert.equal((await cmd(employee,tenantA,needId,{command:'review_work_report',reportId:report2,decision:'accepted',reason:'Tentativa indevida'})).status,403);
 const finish=await cmd(rafael,tenantA,needId,{command:'review_work_report',reportId:report2,decision:'accepted',reason:'Conferido e aceito mediante evidência operacional'});
 assert.equal(finish.status,200);assert.equal(finish.body.status,'completed');assert.equal(finish.body.readyForMeasurement,true);
 assert.deepEqual((await pool.query('SELECT status,version FROM service_orders WHERE id=$1',[orderId])).rows[0],{status:'completed',version:4});

 // Tier 1 vertical slice: accepted report -> linked measurement -> independent approval -> billing -> A/R.
 assert.equal((await orderCommand(post(abrahim,{id:orderId,version:4,key:randomUUID(),command:'measure',description:'Medição genérica sem relatório',amount:'4500,00'}))).status,409,'generic endpoint cannot bypass accepted field report');
 const measureId=randomUUID(),measureKey=randomUUID();
 const prepare={action:'prepare',id:measureId,commandKey:measureKey,description:'Medição das horas e materiais conferidos na OS fictícia',amountCents:450000};
 assert.equal((await measurePost(admin,tenantA,needId,prepare)).status,403,'admin without verified dual ownership cannot measure');
 assert.equal((await measurePost(otherOwner,tenantA,needId,prepare)).status,404,'different tenant denied');
 assert.equal((await measurePost(abrahim,tenantA,needId,{...prepare,id:randomUUID(),commandKey:randomUUID(),amountCents:510000})).status,409,'commercial limit from original need is enforced');
 const measured=await measurePost(abrahim,tenantA,needId,prepare);
 assert.equal(measured.status,201,JSON.stringify(await measured.clone().json()));
 assert.equal((await measurePost(abrahim,tenantA,needId,prepare)).status,200,'same measurement command idempotent');
 assert.equal((await measurePost(abrahim,tenantA,needId,{...prepare,id:randomUUID(),commandKey:randomUUID()})).status,409,'one accepted report never gets duplicate measurement');
 assert.equal((await measurementGet(get(employee),np(tenantA,needId))).status,403,'commercial dossier inaccessible to employee');
 const draftMeas=await (await measurementGet(get(rafael),np(tenantA,needId))).json() as any;
 assert.equal(draftMeas.measurements[0].status,'draft');
 assert.equal(draftMeas.measurements[0].commercialSnapshot.authorizedCeilingCents,'499900');
 assert.equal(draftMeas.measurements[0].commercialSnapshot.reportId,report2);
 assert.equal(draftMeas.measurements[0].executedSnapshot.length,2);
 assert.equal((await orderCommand(post(abrahim,{id:measureId,version:1,key:randomUUID(),command:'approve_measurement'}))).status,409,'generic approval never bypasses four eyes');
 const approve={action:'approve',measurementId:measureId,commandKey:randomUUID(),reason:'Valores e relatório operacional conferidos pelo segundo controlador',expectedVersion:1};
 assert.equal((await measurePost(abrahim,tenantA,needId,approve)).status,403,'maker cannot authorize their measurement');
 assert.equal((await measurePost(admin,tenantA,needId,approve)).status,403,'non-owner cannot approve');
 const measurementApproval=await measurePost(rafael,tenantA,needId,approve);
 assert.equal(measurementApproval.status,201,JSON.stringify(await measurementApproval.clone().json()));
 assert.equal((await measurePost(rafael,tenantA,needId,approve)).status,200,'approval idempotency');
 await assert.rejects(()=>pool.query('DELETE FROM svc_measurement_approvals WHERE measurement_id=$1',[measureId]),/APPEND_ONLY/);
 const billingKey=randomUUID();
 const invoiceCommand={id:measureId,version:2,key:billingKey,command:'invoice',dueDate:'2026-12-20'};
 await pool.query("UPDATE accounting_posting_rules SET active=0 WHERE actor_id=$1 AND source_type='invoice_billing'",[abrahim]);
 assert.equal((await orderCommand(post(rafael,invoiceCommand))).status,409,'linked service cannot create unposted invoice with no configured AR/revenue rule');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM invoices WHERE measurement_id=$1',[measureId])).rows[0].n,0,'rejected invoice leaves no financial side effects');
 await pool.query("UPDATE accounting_posting_rules SET active=1 WHERE actor_id=$1 AND source_type='invoice_billing'",[abrahim]);
 const billed=await orderCommand(post(rafael,invoiceCommand));
 assert.equal(billed.status,201,JSON.stringify(await billed.clone().json()));
 const billingBody=await billed.json() as any;
 assert.ok(billingBody.resource?.invoiceId,'invoice identity must exist');
 assert.ok(billingBody.resource?.receivableId,'receivable identity must exist');
 assert.equal(billingBody.resource.amount,'45000000','native financial book stores R$ 4.500,00 as units of 1/10,000');
 assert.equal(billingBody.resource.accounting.status,'auto_posted','real configured dual-control AR/revenue rule must post the journal atomically');
 assert.ok(billingBody.resource.accounting.journalId,'journal must be linked in billing transaction');
 const journal=await pool.query('SELECT actor_id,status FROM journal_entries WHERE id=$1',[billingBody.resource.accounting.journalId]);
 assert.equal(journal.rows[0].actor_id,abrahim,'canonical OS financial ledger owns posted accounting, not the personal clicking identity');
 assert.equal(journal.rows[0].status,'posted');
 const invoiceLink=await pool.query('SELECT actor_id FROM accounting_invoice_links WHERE invoice_id=$1',[billingBody.resource.invoiceId]);
 assert.equal(invoiceLink.rows[0].actor_id,abrahim,'invoice origin links preserve canonical ledger ownership');
 const billAudit=await pool.query("SELECT actor_id,metadata FROM finance_audit_events WHERE entity_type='invoice' AND entity_id=$1 AND action='invoice_auto_posted'",[billingBody.resource.invoiceId]);
 assert.equal(billAudit.rows[0].actor_id,rafael,'audit preserves who actually initiated the invoice');
 assert.equal(JSON.parse(String(billAudit.rows[0].metadata)).ledgerOwnerId,abrahim,'ledger ownership must be retained in the immutable JSON audit payload');
 const postingToday=new Date().toISOString().slice(0,10);
 const currentMonthStart=postingToday.slice(0,8)+'01';
 const nextMonthStart=new Date(Date.UTC(Number(postingToday.slice(0,4)),Number(postingToday.slice(5,7)),1)).toISOString().slice(0,10);
 const closing=await database().transaction(q=>getPeriodCloseReadiness(q,abrahim,currentMonthStart,nextMonthStart));
 assert.equal(closing.blockingInvoices,0,'financial closure must recognize a verified co-owner posting into the canonical GL');

 assert.equal((await orderCommand(post(rafael,invoiceCommand))).status,200,'same controller invoice replay');
 const dossier=await (await measurementGet(get(abrahim),np(tenantA,needId))).json() as any;
 assert.equal(dossier.measurements[0].status,'billed');
 assert.equal(dossier.measurements[0].invoiceId,billingBody.resource.invoiceId);
 assert.equal(dossier.measurements[0].receivableId,billingBody.resource.receivableId);
 assert.equal(dossier.measurements[0].amountCents,450000);
 assert.equal(dossier.measurements[0].settledCents,'0');
 assert.equal((await controlTowerGet(get(employee),tp(tenantA))).status,403,'employees cannot access enterprise KPIs');
 assert.equal((await controlTowerGet(get(admin),tp(tenantA))).status,403,'admins without declaration cannot access owner financial indicators');
 assert.equal((await controlTowerGet(get(otherOwner),tp(tenantA))).status,404,'tenants must be invisible to outsiders');
 const tower=await (await controlTowerGet(get(abrahim),tp(tenantA))).json() as any;
 assert.equal(tower.kpis.completed,1);
 assert.equal(tower.finance.not_measured,0);
 assert.equal(tower.finance.awaiting_invoice,0);
 assert.equal(tower.finance.billed,1);
 assert.equal(tower.finance.billed_cents,'450000');
 // The canonical financial owner receives the cash in the same originating GL.
 const cashKey=randomUUID();
 const receiptCommand={receivableId:billingBody.resource.receivableId,amount:'10000000',
  effectiveDate:postingToday,reference:'Synthetic transfer - first installment',commandKey:cashKey};
 const payment=await recordReceipt(post(abrahim,receiptCommand));
 assert.equal(payment.status,201,JSON.stringify(await payment.clone().json()));
 const paymentResult=await payment.json() as any;
 assert.equal(paymentResult.resource.accounting.status,'auto_posted');
 assert.ok(paymentResult.resource.accounting.journalId);
 assert.equal((await recordReceipt(post(abrahim,receiptCommand))).status,200,'receipt retry cannot double-post cash');
 assert.equal((await recordReceipt(post(rafael,{...receiptCommand,commandKey:randomUUID()}))).status,404,'secondary administrator cannot post cash into the canonical financial ledger');
 assert.equal((await recordReceipt(post(abrahim,{...receiptCommand,commandKey:randomUUID(),amount:'40000000'}))).status,409,'cannot settle more than remaining balance');
 const afterCash=await (await measurementGet(get(abrahim),np(tenantA,needId))).json() as any;
 assert.equal(afterCash.measurements[0].settledCents,'100000','native settlement converts back to cents exactly');
 assert.equal(afterCash.canSettleReceivable,true);
 assert.equal(afterCash.settlements.length,1);
 assert.equal(afterCash.settlements[0].kind,'receipt');
 assert.equal(afterCash.settlements[0].amountCents,100000);
 const secondaryDossier=await (await measurementGet(get(rafael),np(tenantA,needId))).json() as any;
 assert.equal(secondaryDossier.canSettleReceivable,false,'secondary controller sees amounts but cannot book cash in wrong ledger');
 assert.equal(secondaryDossier.settlements.length,0);
 const afterCashTower=await (await controlTowerGet(get(rafael),tp(tenantA))).json() as any;
 assert.equal(afterCashTower.finance.billed_cents,'450000','cash settlement does not rewrite original revenue');
 assert.equal(afterCashTower.finance.received_cents,'100000');
 assert.equal(afterCashTower.finance.open_receivables,1);
 assert.equal(afterCashTower.finance.overdue_receivables,0);
 const closeAfterCash=await database().transaction(q=>getPeriodCloseReadiness(q,abrahim,currentMonthStart,nextMonthStart));
 assert.equal(closeAfterCash.blockingInvoices,0,'invoice and receipt remain auditable during financial period close');
 assert.equal(closeAfterCash.invalidCashLinks,0,'receipt GL must link to the originating AR ledger');

 assert.equal(tower.pendingAdditionals,0);

 assert.equal((await pool.query('SELECT count(*)::int AS n FROM invoices WHERE measurement_id=$1',[measureId])).rows[0].n,1);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM receivables WHERE invoice_id=$1',[billingBody.resource.invoiceId])).rows[0].n,1);
 await assert.rejects(()=>pool.query('UPDATE svc_measurement_links SET proposed_amount_cents=1 WHERE measurement_id=$1',[measureId]),/APPEND_ONLY/);

 assert.equal((await pool.query("SELECT count(*)::int AS n FROM order_events WHERE order_id=$1 AND command='complete'",[orderId])).rows[0].n,1);
 assert.equal((await cmd(rafael,tenantA,needId,{command:'review_work_report',reportId:report2,decision:'accepted',reason:'Duplicar aceite'})).status,409);
 assert.equal((await cmd(employee,tenantA,needId,{command:'record_actual',id:randomUUID(),assignmentId,line:{kind:'hours',resourceRef:'Horas campo',quantityMilli:1000,unit:'h'}})).status,409);
 assert.equal((await cmd(employee,tenantA,needId,{command:'mark_viewed',assignmentId})).status,409);
 const reportSnapshots=await pool.query('SELECT id,plan_revision,jsonb_array_length(actual_snapshot)::int AS actual_count FROM svc_work_reports WHERE need_id=$1 ORDER BY submitted_at,id',[needId]);
 assert.deepEqual(reportSnapshots.rows.map(x=>x.actual_count),[1,2],'each submitted report freezes its own execution snapshot');
 assert.ok(reportSnapshots.rows.every(x=>x.plan_revision===1));
 await assert.rejects(()=>pool.query('DELETE FROM svc_work_reports WHERE id=$1',[report1]),/APPEND_ONLY/);
 await assert.rejects(()=>pool.query('UPDATE svc_work_report_reviews SET decision=$1 WHERE report_id=$2',['accepted',report1]),/APPEND_ONLY/);

 // audit trail records the real actors, kept separate from tenant
 const detail=await (await needDetail(get(rafael),np(tenantA,needId))).json() as any;
 const eventKinds=detail.events.map((e:any)=>e.event);
 for(const event of ['received','analysis_started','approved','commercial_terms_recorded','commercial_document_registered','price_line_registered','converted_to_draft_order','plan_set','released','assigned','viewed','execution_started','field_event_recorded','actual_recorded','additional_requested','additional_decided','additional_recorded','work_report_submitted','work_report_reviewed'])assert.ok(eventKinds.includes(event),event+' must be audited');
 assert.equal(detail.fieldEvents.length,5,'the safety occurrence recorded during pause must remain in the immutable field audit');
 assert.equal(detail.additionalRequests.length,2);
 assert.deepEqual(new Set(detail.additionalRequests.map((x:any)=>x.status)),new Set(['approved','rejected']));
 assert.equal(detail.events.find((e:any)=>e.event==='approved').actorId,rafael);
 assert.equal(detail.additionals.length,3,'reviewed request becomes authorized operational additional');assert.equal(detail.planned.length,4);assert.equal(detail.actual.length,2);
 assert.equal(detail.workReports.length,2);assert.equal(detail.workReports[0].decision,'accepted');
 const hoursVariance=detail.executionVariance.find((v:any)=>v.kind==='hours'&&v.resourceRef==='Horas campo'&&v.unit==='h');
 assert.deepEqual(hoursVariance,{kind:'hours',resourceRef:'Horas campo',unit:'h',plannedMilli:'16000',actualMilli:'19500',varianceMilli:'3500'},'variance is computed by PostgreSQL from immutable planned and real quantities');
 const vehicleVariance=detail.executionVariance.find((v:any)=>v.kind==='vehicle'&&v.resourceRef==='Veículo ficticio V1');
 assert.equal(vehicleVariance.plannedMilli,'1000');assert.equal(vehicleVariance.actualMilli,'0');assert.equal(vehicleVariance.varianceMilli,'-1000');

 assert.equal(detail.planHistory[0].revision,1);assert.equal(detail.need.status,'completed');
 assert.deepEqual(detail.financials,{estimatedCostCents:120000,marginBps:2500});
 // costs/margins hidden from non-owners
 const adminView=await (await needDetail(get(admin),np(tenantA,needId))).json() as any;
 assert.ok(!('financials' in adminView));
 assert.equal((await needDetail(get(employee),np(tenantA,needId))).status,403);
 assert.ok(!('commercial' in adminView));
 assert.equal((await needDetail(get(outsider),np(tenantA,needId))).status,404);
 // no fiscal side effects
 const fiscal=await pool.query("SELECT to_regclass('public.fiscal_documents') IS NOT NULL AS has");
 if(fiscal.rows[0].has)assert.equal((await pool.query('SELECT count(*)::int AS n FROM fiscal_documents')).rows[0].n,0);
});



test('each plan revision freezes the full prior set with reason, actor and distinct release gates',async()=>{
 const needId=randomUUID(),orderId=randomUUID();
 assert.equal((await postNeed(post(abrahim,needBody(needId)),tp(tenantA))).status,201);
 assert.equal((await cmd(abrahim,tenantA,needId,{command:'start_analysis'})).status,200);
 assert.equal((await cmd(rafael,tenantA,needId,{command:'approve',reason:'Recurso disponível para planejar'})).status,200);
 assert.equal((await cmd(abrahim,tenantA,needId,{command:'convert',orderId})).status,200);
 const first=[
  {kind:'vehicle',resourceRef:'CP-07',quantityMilli:1000,unit:'un'},
  {kind:'hours',resourceRef:'CP-07',quantityMilli:8000,unit:'h'},
 ];
 const revised=[
  {kind:'vehicle',resourceRef:'CP-07',quantityMilli:2000,unit:'un'},
  {kind:'hours',resourceRef:'CP-07',quantityMilli:10000,unit:'h'},
  {kind:'team',resourceRef:'Ajudantes',quantityMilli:3000,unit:'pessoa'},
 ];
 const v1=await cmd(abrahim,tenantA,needId,{command:'set_plan',lines:first});
 assert.equal(v1.status,200);assert.equal(v1.body.revision,1);
 assert.equal((await cmd(abrahim,tenantA,needId,{command:'set_plan',lines:revised})).status,400,'revision requires reason');
 const v2=await cmd(rafael,tenantA,needId,{command:'set_plan',reason:'Duas viaturas e ajudante extra para o novo horário',lines:revised});
 assert.equal(v2.status,200);assert.equal(v2.body.revision,2);
 const detail=await (await needDetail(get(abrahim),np(tenantA,needId))).json() as any;
 assert.equal(detail.planHistory.length,2);
 assert.equal(detail.planHistory[0].revision,2);
 assert.equal(detail.planHistory[0].actorId,rafael);
 assert.deepEqual(detail.planHistory[1].lines,first);
 assert.deepEqual(detail.planHistory[0].lines,revised);
 assert.equal(detail.planned.length,3,'only latest plan is the operational projection');
 assert.equal(detail.events.filter((e:any)=>e.event==='plan_set').length,2);
 await assert.rejects(()=>pool.query('UPDATE svc_plan_revisions SET reason=$1 WHERE need_id=$2',['Editar historico',needId]),/APPEND_ONLY/);
 await assert.rejects(()=>pool.query('DELETE FROM svc_plan_revisions WHERE need_id=$1',[needId]),/APPEND_ONLY/);
 assert.equal((await cmd(abrahim,tenantA,needId,{command:'release'})).status,409);
 assert.equal((await orderCommand(post(abrahim,{id:orderId,version:1,key:randomUUID(),command:'authorize'}))).status,201);
 assert.equal((await cmd(rafael,tenantA,needId,{command:'release'})).status,200);
 assert.equal((await cmd(rafael,tenantA,needId,{command:'set_plan',reason:'Alteração tardia',lines:first})).status,409);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM svc_plan_revisions WHERE need_id=$1',[needId])).rows[0].n,2,'no post-release revision');
});



test('global release cannot exceed registered customer budget even when a contract version allows more',async()=>{
 const needId=randomUUID(),orderId=randomUUID();
 assert.equal((await postNeed(post(abrahim,needBody(needId)),tp(tenantA))).status,201);
 assert.equal((await cmd(abrahim,tenantA,needId,{command:'start_analysis'})).status,200);
 assert.equal((await cmd(rafael,tenantA,needId,{command:'approve',reason:'Análise prévia concluída'})).status,200);
 assert.equal((await cmd(abrahim,tenantA,needId,{command:'convert',orderId})).status,200);
 assert.equal((await cmd(abrahim,tenantA,needId,{command:'set_plan',lines:[{kind:'hours',resourceRef:'Teste teto cliente',quantityMilli:8000,unit:'h'}]})).status,200);
 assert.equal((await orderCommand(post(abrahim,{id:orderId,version:1,key:randomUUID(),command:'authorize'}))).status,201);
 const terms=(sale:number)=>({command:'set_commercial_terms',id:randomUUID(),pricingMode:'global',globalSaleCents:sale,paymentMethod:'transferencia',paymentTerms:'30 dias',maxFinancialCents:700000,maxQuantityMilli:200000});
 assert.equal((await cmd(abrahim,tenantA,needId,terms(600000))).status,200);
 assert.equal((await cmd(rafael,tenantA,needId,{command:'release'})).status,409,'higher contract ceiling cannot bypass lower customer limit');
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM svc_releases WHERE need_id=$1",[needId])).rows[0].n,0,'failed release must not persist any approval');
 assert.equal((await cmd(rafael,tenantA,needId,terms(495000))).status,200);
 assert.equal((await cmd(abrahim,tenantA,needId,{command:'release'})).status,200);
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM svc_releases WHERE need_id=$1",[needId])).rows[0].n,1);
});


test('itemized contract limits reject excess totals, preserve superseded prices and allow corrected release',async()=>{
 const needId=randomUUID(),orderId=randomUUID();
 assert.equal((await postNeed(post(abrahim,needBody(needId)),tp(tenantA))).status,201);
 assert.equal((await cmd(abrahim,tenantA,needId,{command:'start_analysis'})).status,200);
 assert.equal((await cmd(rafael,tenantA,needId,{command:'approve',reason:'Operação itemizada aprovada'})).status,200);
 assert.equal((await cmd(abrahim,tenantA,needId,{command:'set_commercial_terms',id:randomUUID(),pricingMode:'itemized',globalSaleCents:null,paymentMethod:'boleto',paymentTerms:'15 dias',maxFinancialCents:100000,maxQuantityMilli:280000,customerRules:'Referência obrigatória'})).status,200);
 const oversized=randomUUID(),corrected=randomUUID();
 assert.equal((await cmd(abrahim,tenantA,needId,{command:'register_price_line',id:oversized,kind:'material',itemRef:'Brita fictícia',quantityMilli:280000,unit:'m3',internalUnitCostCents:100,saleUnitPriceCents:500})).status,200);
 assert.equal((await cmd(abrahim,tenantA,needId,{command:'convert',orderId})).status,200);
 assert.equal((await cmd(rafael,tenantA,needId,{command:'set_plan',lines:[{kind:'material',resourceRef:'Brita fictícia',quantityMilli:280000,unit:'m3'}]})).status,200);
 assert.equal((await orderCommand(post(rafael,{id:orderId,version:1,key:randomUUID(),command:'authorize'}))).status,201);
 assert.equal((await cmd(rafael,tenantA,needId,{command:'release'})).status,409,'sale of 140000 cents exceeds 100000 cents limit');
 assert.equal((await cmd(abrahim,tenantA,needId,{command:'register_price_line',id:corrected,supersedesId:oversized,kind:'material',itemRef:'Brita fictícia',quantityMilli:280000,unit:'m3',internalUnitCostCents:100,saleUnitPriceCents:300})).status,200);
 assert.equal((await cmd(rafael,tenantA,needId,{command:'release'})).status,200,'corrected total 84000 cents meets limit');
 const detail=await (await needDetail(get(rafael),np(tenantA,needId))).json() as any;
 assert.equal(detail.commercial.totals.itemizedSaleCents,'84000');
 assert.equal(detail.commercial.priceLines.length,2);
 assert.equal(detail.commercial.priceLines.find((x:any)=>x.id===oversized).superseded,true);
 await assert.rejects(()=>pool.query("DELETE FROM svc_commercial_price_lines WHERE id=$1",[corrected]),/APPEND_ONLY/);
});

test('tenant isolation: tenant B cannot read, list, or command tenant A needs; orphan rows are impossible',async()=>{
 const needId=randomUUID();
 assert.equal((await postNeed(post(abrahim,needBody(needId)),tp(tenantA))).status,201);
 assert.equal((await needDetail(get(otherOwner),np(tenantB,needId))).status,404,'cross-tenant id probe');
 assert.equal((await needDetail(get(otherOwner),np(tenantA,needId))).status,404);
 assert.equal((await (await listNeeds(get(otherOwner),tp(tenantB))).json() as any).items.length,0);
 assert.equal((await cmd(otherOwner,tenantB,needId,{command:'start_analysis'})).status,404);
 assert.equal((await postNeed(post(otherOwner,needBody(randomUUID())),tp(tenantA))).status,404);
 assert.equal((await postNeed(setTestIdentity(new Request('http://localhost/x',{method:'POST',body:'{}'}),outsider),tp(tenantA))).status,400);
 await assert.rejects(()=>pool.query("INSERT INTO svc_needs(id,tenant_id,channel,origin_ref,client_name,contact_name,service_description,location,requested_date,priority,created_by_actor_id) VALUES(gen_random_uuid(),NULL,'phone','x','Cli','Con','desc','loc','2026-12-01','low','a')"),/null value/);
 await assert.rejects(()=>pool.query("INSERT INTO svc_needs(id,tenant_id,channel,origin_ref,client_name,contact_name,service_description,location,requested_date,priority,created_by_actor_id) VALUES(gen_random_uuid(),$1,'phone','x','Cli','Con','desc','loc','2026-12-01','low','')",[tenantA]),/check/);
 // unauthenticated
 assert.equal((await listNeeds(new Request('http://localhost/x'),tp(tenantA))).status,401);
});

test('unverified owner declarations grant nothing (fail closed)',async()=>{
 await pool.query("UPDATE cisne_erp_owner_declarations SET identity_actor_id=NULL,identity_state='unlinked'");
 const needId=randomUUID();
 assert.equal((await postNeed(post(abrahim,needBody(needId)),tp(tenantA))).status,403,'unverified owners cannot register or approve needs');
});
