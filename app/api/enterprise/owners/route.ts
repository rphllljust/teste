import { database } from '../../../../db/raw';
import { failure, requestContext, respond, type RequestContext } from '../../../../lib/api/http';

export const dynamic='force-dynamic';

/** Authenticated, read-only global declared owners, never used to grant access. */
export async function GET(request:Request){
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request);
  const result=await database().prepare(
   'SELECT owner_key AS "ownerKey",display_name AS "displayName",'+
   'declared_role AS "declaredRole",identity_state AS "identityState" '+
   'FROM cisne_erp_owner_declarations '+
   "ORDER BY CASE owner_key WHEN 'abrahim' THEN 1 WHEN 'rafael' THEN 2 ELSE 3 END"
  ).bind().all();
  return respond({items:result.results,total:result.results.length},ctx);
 }catch(error){return failure(error,ctx);}
}
