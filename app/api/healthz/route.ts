import {Client} from 'pg';
import {verifyStagingWebSchema} from '../../../lib/runtime/staging-web-health.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';

// For the Railway web service only: no public business identifiers, DB names,
// migration names, connection strings, tenant or SQL errors in response.
export async function GET(){
 let client:Client|undefined;
 let ready=false;
 try{
  if(!process.env.DATABASE_URL)throw new Error('DB_CONFIG_UNAVAILABLE');
  client=new Client({
   connectionString:process.env.DATABASE_URL,
   options:'-c default_transaction_read_only=on -c statement_timeout=3500',
   connectionTimeoutMillis:4500,
   query_timeout:4500,
  });
  await client.connect();
  ready=await verifyStagingWebSchema((sql:string)=>client!.query(sql));
 }catch{
  ready=false;
 }finally{
  if(client){
   try{await client.end();}catch{ready=false;}
  }
 }
 return Response.json({status:ready?'ready':'unavailable'},{
  status:ready?200:503,
  headers:{
   'Cache-Control':'no-store',
   'X-Content-Type-Options':'nosniff',
  },
 });
}
