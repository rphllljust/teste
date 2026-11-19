import { NextRequest } from "next/server";
import { z } from "zod";
import { prismadb } from "@/lib/prisma";
import { accountReadScopeWhere, mapLegacyRole } from "@/lib/authz";
import { NEXTCRM_ACCOUNT_CREATE_PATH, NEXTCRM_BRIDGE_MAX_BODY_BYTES, signBridgeResponseForPath, verifyBridgeRequestForPath } from "@/lib/erp-bridge/bridge-protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuid = z.string().uuid();
const changesSchema = z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,40}$/), z.string().max(500).nullable()).superRefine((value, ctx) => {
  const allowed = new Set([
    "officePhone","website","fax","email","billingStreet","billingPostalCode","billingCity","billingState","billingCountry",
    "shippingStreet","shippingPostalCode","shippingCity","shippingState","shippingCountry","description","annualRevenue",
    "memberOf","vat","companyId",
  ]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Unsupported account field", path: [key] });
});
const bodySchema = z.object({
  subjectId: uuid, erpClientId: uuid, tenantKey: z.string().regex(/^[A-Za-z0-9_-]{3,128}$/),
  requestId: uuid, name: z.string().trim().min(2).max(200), changes: changesSchema,
}).strict();
const fields: Record<string,string> = {
  officePhone:"office_phone", website:"website", fax:"fax", email:"email", billingStreet:"billing_street",
  billingPostalCode:"billing_postal_code", billingCity:"billing_city", billingState:"billing_state", billingCountry:"billing_country",
  shippingStreet:"shipping_street", shippingPostalCode:"shipping_postal_code", shippingCity:"shipping_city",
  shippingState:"shipping_state", shippingCountry:"shipping_country", description:"description", annualRevenue:"annual_revenue",
  memberOf:"member_of", vat:"vat", companyId:"company_id",
};
async function readBody(req: NextRequest): Promise<string|null> {
  const cl=req.headers.get("content-length");
  if(cl && (!/^\d{1,5}$/.test(cl)||Number(cl)>NEXTCRM_BRIDGE_MAX_BODY_BYTES)) return null;
  if(!req.body) return null;
  const reader=req.body.getReader(); const chunks:Uint8Array[]=[]; let size=0;
  try { while(true){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>NEXTCRM_BRIDGE_MAX_BODY_BYTES){await reader.cancel().catch(()=>{});return null;}chunks.push(item.value);}
    const all=new Uint8Array(size);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.byteLength;}
    return new TextDecoder("utf-8",{fatal:true}).decode(all);
  } catch { return null; } finally { reader.releaseLock(); }
}
export async function POST(req: NextRequest) {
  const secret=process.env.CISNE_NEXTCRM_BRIDGE_SECRET??""; const instanceKey=process.env.CISNE_NEXTCRM_INSTANCE_KEY??"";
  if(!/^[a-f0-9]{64,128}$/.test(secret)||!/^[A-Za-z0-9_-]{3,128}$/.test(instanceKey)) return Response.json({error:"Unavailable"},{status:503,headers:{"Cache-Control":"no-store"}});
  if(req.nextUrl.pathname!==NEXTCRM_ACCOUNT_CREATE_PATH||req.nextUrl.search||req.method!=="POST"||req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()!=="application/json") return Response.json({error:"Unauthorized"},{status:401});
  const raw=await readBody(req); if(!raw) return Response.json({error:"Unauthorized"},{status:401});
  const proof={timestamp:req.headers.get("x-cisne-bridge-timestamp")??"",nonce:req.headers.get("x-cisne-bridge-nonce")??"",signature:req.headers.get("x-cisne-bridge-signature")??""};
  if(!verifyBridgeRequestForPath(secret,raw,proof,NEXTCRM_ACCOUNT_CREATE_PATH)) return Response.json({error:"Unauthorized"},{status:401,headers:{"Cache-Control":"no-store"}});
  const reply=(status:number,value:Record<string,unknown>)=>{const body=JSON.stringify(value);return new Response(body,{status,headers:{"Content-Type":"application/json","Cache-Control":"private, no-store","X-Cisne-Bridge-Response-Signature":signBridgeResponseForPath(secret,body,status,proof,NEXTCRM_ACCOUNT_CREATE_PATH)}});};
  let input:unknown;try{input=JSON.parse(raw);}catch{return reply(404,{authorized:false});}
  const parsed=bodySchema.safeParse(input);if(!parsed.success||parsed.data.tenantKey!==instanceKey)return reply(404,{authorized:false});
  try {
    const {subjectId,erpClientId,name,changes}=parsed.data;
    const user=await prismadb.users.findUnique({where:{id:subjectId},select:{id:true,role:true,userStatus:true,banned:true}});
    if(!user||user.userStatus!=="ACTIVE"||user.banned)return reply(404,{authorized:false});
    const actor={id:user.id,role:mapLegacyRole(user.role)};
    const existing=await prismadb.crm_Accounts.findFirst({where:{external_ref:erpClientId,...accountReadScopeWhere(actor)},select:{id:true}});
    if(existing)return reply(200,{authorized:true,created:false,accountId:existing.id,erpClientId,tenantKey:instanceKey});
    const data:Record<string,unknown>={v:0,name,createdBy:subjectId,updatedBy:subjectId,assigned_to:subjectId,partnerUserId:null,status:"Active",type:"Customer",external_ref:erpClientId};
    for(const [key,value] of Object.entries(changes))data[fields[key]]=value;
    const account=await prismadb.crm_Accounts.create({data:data as never,select:{id:true}});
    return reply(201,{authorized:true,created:true,accountId:account.id,erpClientId,tenantKey:instanceKey});
  } catch { return reply(503,{error:"Unavailable"}); }
}
