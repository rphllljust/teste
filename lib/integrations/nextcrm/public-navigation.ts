/**
 * Public-only navigation between independent Railway staging applications.
 * This never grants a session, exchanges identity, or maps customer records.
 * The exact allowlist prevents a misconfigured environment variable from
 * becoming an open redirect or an unintended production -> HML entry point.
 */
export const NEXTCRM_STAGING_ORIGIN = "https://nextcrm-gateway-staging.up.railway.app";
export const NEXTCRM_STAGING_ENTRY = NEXTCRM_STAGING_ORIGIN + "/en";

export function resolveNextcrmNavigationHref(
  railwayEnvironmentName: string | undefined,
  configuredPublicOrigin: string | undefined,
): string | null {
  if (railwayEnvironmentName !== "staging") return null;
  if (configuredPublicOrigin !== NEXTCRM_STAGING_ORIGIN) return null;
  return NEXTCRM_STAGING_ENTRY;
}
