import { z } from 'zod';
import { ApiError, failure, requestContext, respond, type RequestContext } from '../../../../lib/api/http';
import { database } from '../../../../db/raw';

const query = z.object({ clientId: z.string().uuid().optional(), contractId: z.string().uuid().optional() }).strict();

export async function GET(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request);
    const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Contexto da ordem inválido.');
    const db = database();
    const client = parsed.data.clientId ? await db.prepare('SELECT id,legal_name,email,phone,document,status,row_version FROM clients WHERE id=? AND owner_id=?').bind(parsed.data.clientId, context.actorId).first<{ id:string; legal_name:string; email:string|null; phone:string|null; document:string|null; status:string; row_version:number }>() : null;
    if (parsed.data.clientId && !client) throw new ApiError(404, 'NOT_FOUND', 'Cliente não encontrado.');
    const contract = parsed.data.contractId ? await db.prepare(`SELECT c.id,c.reference,c.scope,c.status,c.row_version,c.client_id,c.proposal_id,p.title proposal_title,p.status proposal_status,c.purchase_order_id,po.reference po_reference,po.status po_status FROM contracts c JOIN proposals p ON p.id=c.proposal_id LEFT JOIN purchase_orders po ON po.id=c.purchase_order_id WHERE c.id=? AND c.owner_id=?`).bind(parsed.data.contractId, context.actorId).first<Record<string, unknown>>() : null;
    if (parsed.data.contractId && !contract) throw new ApiError(404, 'NOT_FOUND', 'Contrato não encontrado.');
    if (contract && client && String(contract.client_id)!==client.id) throw new ApiError(409, 'INVALID_STATE', 'Contrato não pertence ao cliente selecionado.');
    return respond({
      definitions: { activities: ['Locação','Serviços','Transporte','Obra'], supportedCommands: [{ id:'create_draft', label:'Criar rascunho', endpoint:'/api/orders', method:'POST' }], resourcePreparation:true },
      client: client ? { id:client.id, legalName:client.legal_name, email:client.email, phone:client.phone, document:client.document, state:{ code:client.status, label:client.status==='active'?'Ativo':client.status }, rowVersion:client.row_version } : null,
      contract: contract ? { id:String(contract.id), reference:String(contract.reference), scope:String(contract.scope), status:String(contract.status), rowVersion:Number(contract.row_version), clientId:String(contract.client_id), proposalId:String(contract.proposal_id), proposalTitle:String(contract.proposal_title), proposalStatus:String(contract.proposal_status), purchaseOrderId:contract.purchase_order_id?String(contract.purchase_order_id):null, poReference:contract.po_reference?String(contract.po_reference):null, poStatus:contract.po_status?String(contract.po_status):null } : null,
      relations: client ? { proposals:0, purchaseOrders:0, contracts:0, orders:0 } : null,
      availableCommands: client ? [{ id:'create_draft', label:'Criar rascunho', expectedClientVersion:client.row_version, expectedContractVersion:contract?Number(contract.row_version):null }] : [],
      warnings: [],
    }, context);
  } catch (error) { return failure(error, context); }
}
