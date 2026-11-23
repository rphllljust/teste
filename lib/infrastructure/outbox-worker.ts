import type { TransactionQuery } from './outbox.ts';

export type PendingOutboxEvent={id:string;aggregate_type:string;aggregate_id:string;event_type:string;aggregate_version:number;payload:Record<string,unknown>;correlation_id:string;occurred_at:string;attempts:number};
export async function claimOutboxBatch(query:TransactionQuery,limit=50):Promise<PendingOutboxEvent[]>{
  const boundedLimit=Math.max(1,Math.min(500,Math.trunc(limit)));
  const result=await query(`SELECT id,aggregate_type,aggregate_id,event_type,aggregate_version,payload,correlation_id,occurred_at,attempts FROM integration_outbox WHERE published_at IS NULL AND attempts<10 ORDER BY occurred_at,id FOR UPDATE SKIP LOCKED LIMIT $1`,[boundedLimit]);
  return result.rows as PendingOutboxEvent[];
}
export async function markOutboxPublished(query:TransactionQuery,id:string):Promise<void>{await query(`UPDATE integration_outbox SET published_at=NOW(),last_error=NULL WHERE id=$1 AND published_at IS NULL`,[id]);}
export async function markOutboxFailed(query:TransactionQuery,id:string,error:string):Promise<void>{await query(`UPDATE integration_outbox SET attempts=attempts+1,last_error=$2 WHERE id=$1 AND published_at IS NULL AND attempts<10`,[id,error.slice(0,2000)]);}

export type OutboxPublisher=(event:PendingOutboxEvent)=>Promise<void>;
/** Claims and publishes one bounded batch. The publisher must be idempotent. */
export async function drainOutbox(queryFactory:()=>Promise<{query:TransactionQuery}>,publish:OutboxPublisher,limit=50):Promise<{published:number;failed:number}>{
  const tx=await queryFactory(); const events=await claimOutboxBatch(tx.query,limit); let published=0,failed=0;
  for(const event of events){try{await publish(event);await markOutboxPublished(tx.query,event.id);published++;}catch(error){await markOutboxFailed(tx.query,event.id,error instanceof Error?error.message:'Unknown publisher error');failed++;}}
  return {published,failed};
}
