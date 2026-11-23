import type { QueryResult } from 'pg';
export type TransactionQuery = (sql: string, params?: unknown[]) => Promise<QueryResult>;
export type OutboxEvent = { id:string; aggregateType:string; aggregateId:string; eventType:string; aggregateVersion:number; payload:Record<string,unknown>; correlationId:string; occurredAt:string };
/** Must run in the aggregate transaction; the unique aggregate key makes retries safe. */
export async function enqueueOutboxEvent(query:TransactionQuery,event:OutboxEvent):Promise<void>{
  await query(`INSERT INTO integration_outbox (id,aggregate_type,aggregate_id,event_type,aggregate_version,payload,correlation_id,occurred_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8) ON CONFLICT (aggregate_type,aggregate_id,event_type,aggregate_version) DO NOTHING`,[event.id,event.aggregateType,event.aggregateId,event.eventType,event.aggregateVersion,JSON.stringify(event.payload),event.correlationId,event.occurredAt]);
}
