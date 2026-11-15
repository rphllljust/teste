import { resolveNextcrmNavigationHref } from "../../../../../lib/integrations/nextcrm/public-navigation";

/** Public link metadata only. No credentials, session, or backend bridge URL. */
export const dynamic = "force-dynamic";

export async function GET() {
  const href = resolveNextcrmNavigationHref(
    process.env.RAILWAY_ENVIRONMENT_NAME,
    process.env.CISNE_NEXTCRM_PUBLIC_URL,
  );
  return Response.json(
    { enabled: href !== null, href },
    { headers: { "Cache-Control": "no-store, private" } },
  );
}
