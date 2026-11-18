const PUBLIC_URL =
  /^https:\/\/[^/?#:]+(?:\:\d+)?(?:\/[^/?#]*)?$/i;
const INSTANCE = /^[A-Za-z0-9_-]{3,128}$/;
const SECRET = /^[a-f0-9]{64,128}$/i;

export type NextcrmReadinessInput = {
  environment?: string;
  publicUrl?: string;
  bridgeSecretConfigured: boolean;
  instanceKey?: string;
  schemaApplied: boolean;
  activeIdentityMappings: number;
  activeAccountMappings: number;
};

export type NextcrmReadiness = {
  enabled: boolean;
  ready: boolean;
  environmentAllowed: boolean;
  publicUrlAllowed: boolean;
  bridgeConfigured: boolean;
  schemaApplied: boolean;
  activeIdentityMappings: number;
  activeAccountMappings: number;
  blockers: string[];
};

export function evaluateNextcrmReadiness(input: NextcrmReadinessInput): NextcrmReadiness {
  const environmentAllowed = input.environment === 'staging';
  const publicUrlAllowed = typeof input.publicUrl === 'string' &&
    PUBLIC_URL.test(input.publicUrl) &&
    !input.publicUrl.includes('?') &&
    !input.publicUrl.includes('#') &&
    !/:(?:80|3000)(?:\/|$)/.test(input.publicUrl);

  const bridgeConfigured =
    input.bridgeSecretConfigured &&
    typeof input.instanceKey === 'string' &&
    INSTANCE.test(input.instanceKey);

  const blockers: string[] = [];
  if (!environmentAllowed) blockers.push('STAGING_ONLY');
  if (!publicUrlAllowed) blockers.push('PUBLIC_URL_NOT_APPROVED');
  if (!bridgeConfigured) blockers.push('BRIDGE_CONFIGURATION_MISSING');
  if (!input.schemaApplied) blockers.push('MIGRATION_NOT_APPLIED');
  if (input.activeIdentityMappings < 1) blockers.push('IDENTITY_MAPPING_REQUIRED');
  if (input.activeAccountMappings < 1) blockers.push('ACCOUNT_MAPPING_REQUIRED');

  return {
    enabled: environmentAllowed && publicUrlAllowed,
    ready: blockers.length === 0,
    environmentAllowed,
    publicUrlAllowed,
    bridgeConfigured,
    schemaApplied: input.schemaApplied,
    activeIdentityMappings: input.activeIdentityMappings,
    activeAccountMappings: input.activeAccountMappings,
    blockers,
  };
}

/** Only presence/shape is exposed; the secret itself never leaves the server. */
export function isBridgeSecretConfigured(secret: string | undefined): boolean {
  return typeof secret === 'string' && SECRET.test(secret);
}
