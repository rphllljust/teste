import {database} from '../../db/raw';
import {ApiError} from './http';
export async function previousResult(key:string,hash:string){const prior=await database().prepare('SELECT request_hash,result FROM order_events WHERE id=?').bind(key).first<{request_hash:string|null;result:string|null}>();if(!prior)return null;if(prior.request_hash!==hash||!prior.result)throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Esta chave já foi usada por outra requisição.');return JSON.parse(prior.result) as Record<string,unknown>;}
