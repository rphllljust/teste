import { database } from '../../../db/raw';
import { requestContext, respond, type RequestContext } from '../../../lib/api/http';

export const dynamic = 'force-dynamic';

const COMPANY_CNPJ = '11897171000181';

export async function GET(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request);
    const db = database();
    const result = await db.batch([
      db.prepare(
        `SELECT cnpj,legal_name AS "legalName",trade_name AS "tradeName",
                address,city,state,status
         FROM company_profiles WHERE cnpj=? AND status='active'`,
      ).bind(COMPANY_CNPJ),
      db.prepare(
        `SELECT id,cnae,name,category,description
         FROM service_catalog
         WHERE company_cnpj=? AND active=true
         ORDER BY category,name,id`,
      ).bind(COMPANY_CNPJ),
    ]);
    return respond({
      company: result[0].results[0] ?? null,
      services: result[1].results,
      source: 'CNPJ cadastral público; confirmação fiscal vigente deve ser feita na Receita Federal',
    }, context);
  } catch {
    return new Response(JSON.stringify({
      error: 'Catálogo de serviços indisponível.',
      code: 'SERVICE_CATALOG_UNAVAILABLE',
    }), {
      status: 503,
      headers: { 'Cache-Control': 'no-store, private', 'Content-Type': 'application/json' },
    });
  }
}
