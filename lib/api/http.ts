import { isPublicDemoModeEnabled } from '../public-demo-mode.mjs';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}
export type RequestContext={actorId:string;correlationId:string};
export function requestContext(request:Request,mutation=false):RequestContext{
 const incoming=request.headers.get('x-correlation-id'),correlationId=incoming&&/^[a-zA-Z0-9_-]{8,64}$/.test(incoming)?incoming:crypto.randomUUID();
 if(isPublicDemoModeEnabled())throw new ApiError(403,'DEMO_READ_ONLY','As operações empresariais estão desativadas no modo público de demonstração.');
 const actorId=request.headers.get('oai-authenticated-user-id');
 if(!actorId||actorId.length>200)throw new ApiError(401,'AUTHENTICATION_REQUIRED','Entre com sua conta para acessar a operação.');
 if(mutation){const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)throw new ApiError(403,'FORBIDDEN','Origem não autorizada.');}
 // Sites dispatch enforces this application's existing owner-only access policy.
 // Identity is forwarded by dispatch, never accepted in a request payload.
 return {actorId,correlationId};
}
export function respond(data:object,context:RequestContext,status=200){return Response.json({...data,correlationId:context.correlationId},{status,headers:{'Cache-Control':'no-store','X-Correlation-Id':context.correlationId}});}
export function failure(error:unknown,context?:RequestContext){const invariant=error instanceof Error&&/CISNE_(ACCOUNTING_OWNER_INVARIANT|BANK_OWNER_INVARIANT|FINANCE_OWNER_INVARIANT|BILLING_CHAIN_INVARIANT|IMMUTABLE_FINANCIAL_FACT|SETTLEMENT_INVARIANT|STATEMENT_INVARIANT|RECONCILIATION_INVARIANT|JOURNAL_INVARIANT|PREFERENCE_INVARIANT|CLIENT_INVARIANT|COMMAND_INVARIANT|COMMERCIAL_INVARIANT|CONTRACT_INVARIANT|EXECUTION_INVARIANT)/.test(error.message);const safe=error instanceof ApiError?error:invariant?new ApiError(409,'CONSTRAINT_VIOLATION','A operação viola a integridade dos registros.'):new ApiError(503,'DEPENDENCY_UNAVAILABLE','O serviço está indisponível. Seus dados foram preservados; tente novamente.');const correlationId=context?.correlationId??crypto.randomUUID();if(safe.status>=500)console.error(JSON.stringify({event:'api.failure',code:safe.code,correlationId,type:error instanceof Error?error.name:'Unknown'}));return Response.json({error:safe.message,code:safe.code,correlationId,retryable:safe.status===503},{status:safe.status,headers:{'Cache-Control':'no-store','X-Correlation-Id':correlationId}});}
export async function jsonBody(request:Request){try{return await request.json();}catch{throw new ApiError(400,'VALIDATION_FAILED','O conteúdo da requisição não é válido.');}}
export async function fingerprint(value:unknown){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
export function validDate(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;}
