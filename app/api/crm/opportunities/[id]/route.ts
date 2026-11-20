import { z } from 'zod';
import { database } from '../../../../../db/raw';
import { ApiError, failure, requestContext, respond, type RequestContext } from '../../../../../lib/api/http';

export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ id: string }> };

type Opportunity = {
  id: string;
  leadId: string;
  title: string;
  amountCents: string;
  stage: string;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
  lead: { contactName: string; companyName: string; contactEmail: string | null; status: string };
  client: { id: string; legalName: string } | null;
  proposal: { id: string; status: string; total: string; validUntil: string } | null;
  history: { action: string; createdAt: string; result: string }[];
};

export async function GET(request: Request, { params }: RouteContext) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success)
      throw new ApiError(400, 'VALIDATION_FAILED', 'Identificador de oportunidade inválido.');

    const db = database();
    const opportunity = await db.prepare(`
      SELECT o.id, o.lead_id AS "leadId", o.title,
        o.amount_cents::text AS "amountCents", o.stage,
        o.row_version AS "rowVersion", o.created_at AS "createdAt", o.updated_at AS "updatedAt",
        l.contact_name AS "leadContactName", l.company_name AS "leadCompanyName",
        l.contact_email AS "leadContactEmail", l.status AS "leadStatus",
        c.id AS "clientId", c.legal_name AS "clientLegalName",
        p.id AS "proposalId", p.status AS "proposalStatus",
        p.total::text AS "proposalTotal", p.valid_until AS "proposalValidUntil"
      FROM crm_opportunities o
      JOIN crm_leads l ON l.owner_id=o.owner_id AND l.id=o.lead_id
      LEFT JOIN clients c ON c.owner_id=o.owner_id AND c.id=o.client_id
      LEFT JOIN crm_opportunity_proposals link
        ON link.owner_id=o.owner_id AND link.opportunity_id=o.id
      LEFT JOIN proposals p ON p.owner_id=link.owner_id AND p.id=link.proposal_id
      WHERE o.owner_id=? AND o.id=?
    `).bind(context.actorId, id).first<{
      id: string; leadId: string; title: string; amountCents: string; stage: string;
      rowVersion: number; createdAt: string; updatedAt: string;
      leadContactName: string; leadCompanyName: string; leadContactEmail: string | null;
      leadStatus: string; clientId: string | null; clientLegalName: string | null;
      proposalId: string | null; proposalStatus: string | null; proposalTotal: string | null;
      proposalValidUntil: string | null;
    }>();
    if (!opportunity) throw new ApiError(404, 'NOT_FOUND', 'Oportunidade não encontrada.');

    const history = await db.prepare(`
      SELECT action, created_at AS "createdAt", result
      FROM crm_commands
      WHERE actor_id=? AND resource_id=?
      UNION ALL
      SELECT cc.action, cc.created_at AS "createdAt", cc.result
      FROM crm_commands cc
      JOIN crm_opportunity_proposals link
        ON link.command_key=cc.id AND link.owner_id=? AND link.opportunity_id=?
      WHERE cc.actor_id=?
      ORDER BY "createdAt" DESC
      LIMIT 50
    `).bind(context.actorId, id, context.actorId, id, context.actorId).all<{ action: string; createdAt: string; result: string }>();

    const projection: Opportunity = {
      id: opportunity.id,
      leadId: opportunity.leadId,
      title: opportunity.title,
      amountCents: opportunity.amountCents,
      stage: opportunity.stage,
      rowVersion: opportunity.rowVersion,
      createdAt: opportunity.createdAt,
      updatedAt: opportunity.updatedAt,
      lead: {
        contactName: opportunity.leadContactName,
        companyName: opportunity.leadCompanyName,
        contactEmail: opportunity.leadContactEmail,
        status: opportunity.leadStatus,
      },
      client: opportunity.clientId && opportunity.clientLegalName
        ? { id: opportunity.clientId, legalName: opportunity.clientLegalName }
        : null,
      proposal: opportunity.proposalId && opportunity.proposalStatus && opportunity.proposalTotal && opportunity.proposalValidUntil
        ? { id: opportunity.proposalId, status: opportunity.proposalStatus, total: opportunity.proposalTotal, validUntil: opportunity.proposalValidUntil }
        : null,
      history: history.results,
    };
    return respond({ projection }, context);
  } catch (error) {
    return failure(error, context);
  }
}
