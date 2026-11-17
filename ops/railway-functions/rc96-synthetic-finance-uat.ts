// RC96 one-time Railway staging UAT for real Field HTTP handlers.
// Source is reviewable in GitHub; deploy ONLY into the EXISTING private
// rc86 ERP probe Function. No new service, volume, public URL or production.
// Written business records are synthetic and remain auditably in HML.
// Never run period-close on the shared canonical Field staging database.
import { SQL } from "bun";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
const env=Bun.env;
const PROJECT="0835d357-6037-42e6-a534-6456422e1cf3";
const ENV="c241a855-68b7-4d75-a722-b6a42c8581e9";
const FIELD="cisne-rc85-ephemeral-erp.railway.internal";
const ACTOR=env.RC96_ACTOR_ID??"";
const SESSION=env.RC96_SESSION_SECRET??"";
const KEY=env.RC96_WRITE_SIGNING_KEY??"";
const UNTIL=Number(env.RC96_WRITE_UNTIL_MS);
const BASE="http://"+FIELD+":8080";
const log=(event,extra={})=>console.log(event,JSON.stringify(extra));
let stage="guard";
let db;
const approved=env.RAILWAY_PROJECT_ID===PROJECT &&
 env.RAILWAY_ENVIRONMENT_ID===ENV &&
 env.RAILWAY_ENVIRONMENT_NAME==="staging" &&
 env.RAILWAY_SERVICE_NAME==="rc86-erp-private-readonly-health-probe" &&
 env.RC96_APPROVED==="rc96-synthetic-actor-only-one-shot" &&
 /^[a-f0-9]{64}$/.test(KEY) && SESSION.length>=32 && ACTOR.length>=8 &&
 Number.isSafeInteger(UNTIL) && UNTIL>Date.now() && UNTIL-Date.now()<=10*60*1000;
if(!approved){
 console.error("RC96_NO_GO_PRECONDITION");
 process.exit(96);
}
let url;
try{url=new URL(env.RC96_FIELD_DATABASE_URL??"");}catch{}
if(!url || url.protocol!=="postgresql:" ||
 url.hostname!=="cisne-rc75-postgres-uat.railway.internal" ||
 url.port!=="5432"||url.pathname!=="/cisne_rc89_field" ||
 url.username!=="cisne_rc89_field_app" || !/^[a-f0-9]{64}$/.test(url.password) ||
 url.hash || url.search){
 console.error("RC96_NO_GO_DB_IDENTITY");
 process.exit(96);
}
const now=Date.now(), payload=Buffer.from(JSON.stringify({
 v:1,sub:ACTOR,iat:now,exp:now+8*60*60*1000,
 nonce:randomBytes(16).toString("hex")
})).toString("base64url");
const cookie="__Host-cisne_staging="+payload+"."+
  createHmac("sha256",SESSION).update(payload).digest("base64url");
const signed=(path)=>{
 const ts=Date.now();
 if(ts>UNTIL || UNTIL-ts>10*60*1000)throw Error("UAT_PERMIT_EXPIRED");
 const nonce=randomBytes(16).toString("hex");
 const signedData=["rc95/v1","POST",path,String(ts),nonce,ACTOR,ENV].join("\n");
 const digest=createHmac("sha256",KEY).update(signedData).digest("hex");
 return ["v1",ts,nonce,digest].join(".");
};
const request=async(method,path,body,expected)=>{
 stage=method+" "+path.replace(/[0-9a-f-]{36}/g,":id");
 const headers={cookie,"content-type":"application/json"};
 if(method==="POST")headers["x-cisne-rc95-uat"]=signed(path);
 const response=await fetch(BASE+path,{
  method,headers,body:method==="POST"?JSON.stringify(body):undefined,
  signal:AbortSignal.timeout(9000),cache:"no-store",redirect:"error"
 });
 let result={};
 try{result=await response.json();}catch{}
 if(!expected.includes(response.status))
   throw {code:"HTTP_CONTRACT_FAILED",status:response.status,phase:stage,
     apiCode:typeof result?.code==="string"?result.code.slice(0,36):"UNSPECIFIED"};
 return {status:response.status,result};
};
const uuid=()=>randomUUID();
const orderId=uuid(),clientId=uuid();
try{
 stage="readonly-preflight";
 db=new SQL(env.RC96_FIELD_DATABASE_URL,{max:1,connectionTimeout:5});
 const locked=await db.unsafe("SELECT pg_try_advisory_lock(96011796) AS yes");
 if(locked[0]?.yes!==true)throw {code:"UAT_LOCK_BUSY"};
 const check=await db.unsafe(
 "SELECT current_database()='cisne_rc89_field' AS db_ok, "+
 "current_user='cisne_rc89_field_app' AS role_ok, "+
 "(SELECT count(*) FROM _cisne_schema_migrations)=7 AS migrations_ok, "+
 "(SELECT count(*) FROM clients WHERE owner_id=$1)=0 AS no_clients, "+
 "(SELECT count(*) FROM service_orders WHERE owner_id=$1)=0 AS no_orders",
 [ACTOR]
 );
 const x=check[0];
 if(!x || !x.db_ok||!x.role_ok||!x.migrations_ok||!x.no_clients||!x.no_orders)
   throw {code:"ACTOR_NOT_DISPOSABLE_OR_MIGRATIONS_MISSING"};
 stage="readiness";
 await request("GET","/api/health/ready",null,[200]);
 stage="create_synthetic_client";
 const cli=await request("POST","/api/clients",{
  id:clientId,data:{legalName:"RC96 Integration Synthetic Customer",
   tradeName:null,document:null,email:null,phone:null}},[201]);
 if(cli?.result?.resource?.id!==clientId)
   throw {code:"CLIENT_CREATED_WRONG_ID"};
 stage="create_synthetic_service_order";
 const create=await request("POST","/api/orders",{
  id:orderId,title:"RC96 Synthetic Field NextCRM Finance UAT",
  category:"Serviços",description:"TEST ONLY — no actual customer",
  dueDate:null,clientId,clientVersion:1},[201]);
 if(!create?.result?.resource?.id && !create?.result?.order?.id)
   throw {code:"ORDER_NOT_CREATED"};
 const step=async(id,version,command,extra={})=>{
  const got=await request("POST","/api/commands",{
   id,version,key:uuid(),command,...extra},[201]);
  if(!got.result?.resource?.id)throw {code:"COMMAND_DID_NOT_PERSIST",phase:command};
  return got.result.resource;
 };
 stage="os-authorize";await step(orderId,1,"authorize");
 stage="os-start";await step(orderId,2,"start");
 stage="os-complete";await step(orderId,3,"complete");
 stage="os-measure";const measurement=await step(orderId,4,"measure",{
  description:"RC96 synthetic measurement",amount:"12"});
 stage="measurement-approve";await step(measurement.id,1,"approve_measurement");
 stage="invoice";const invoice=await step(measurement.id,2,"invoice",{dueDate:"2026-12-01"});
 if(!invoice.receivableId)throw {code:"RECEIVABLE_LINK_MISSING"};
 stage="finance-before";const before=await request("GET","/api/orders/"+orderId,null,[200]);
 if(before.result?.order?.finance?.invoicedScaled!=="120000")
  throw {code:"INVOICE_NOT_LINKED_TO_ORDER"};
 const settlementKey=uuid(),settle={
  receivableId:invoice.receivableId,amount:"25000",effectiveDate:"2026-11-16",
  reference:"RC96 synthetic UAT partial receipt",commandKey:settlementKey};
 stage="settlement";await request("POST","/api/finance/receivables/settlements",settle,[201]);
 stage="idempotent-replay";await request("POST","/api/finance/receivables/settlements",settle,[200]);
 stage="settlement-reverse";await request("POST",
  "/api/finance/receivables/settlements/"+settlementKey+"/reverse",{
  commandKey:uuid(),effectiveDate:"2026-11-17",
  reference:"RC96 synthetic UAT receipt reversal"},[201]);
 stage="finance-after";const after=await request("GET","/api/orders/"+orderId,null,[200]);
 const finance=after.result?.order?.finance;
 if(finance?.invoicedScaled!=="120000"||
   finance?.settledScaled!=="0"||finance?.outstandingScaled!=="120000")
  throw {code:"REVERSAL_OR_OUTSTANDING_INVARIANT"};
 // Do NOT close a global financial period on this persistent shared HML DB.
 log("RC96_LIVE_SAME_OS_SYNTHETIC_FINANCE_PASS",{
  scope:"Railway_private_HML_real_handlers",
  readOnlyGlobal:true,writer:"short-lived-RC95-HMAC-only",
  sourceDatabase:"cisne_rc89_field",sameOrder:true,
  clientCreated:true,osCommandChain:true,measurement:true,
  invoice:true,receivable:true,partialSettlement:true,
  replayWasIdempotent:true,reversal:true,
  moneyRecovered:true,periodCloseSkipped:"protect-shared-staging",
  nextcrmDocumentBridgeSkipped:"requires-separate-RC97-S3-fixture",
  syntheticOnly:true
 });
}catch(err){
 const code=typeof err?.code==="string"?err.code.slice(0,55):"UNKNOWN";
 const status=Number.isInteger(err?.status)?err.status:undefined;
 const apiCode=typeof err?.apiCode==="string"?err.apiCode:undefined;
 console.error("RC96_LIVE_UAT_NO_GO",JSON.stringify({stage,code,status,apiCode,
  syntheticRecordsMayExist:true}));
 process.exitCode=1;
}finally{
 if(db){
  try{await db.unsafe("SELECT pg_advisory_unlock(96011796)");}catch{}
  try{await db.close();}catch{}
 }
}
