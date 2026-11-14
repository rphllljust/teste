// Read-only guard intended to run immediately before any staging deployment.
const EXPECTED_PROJECT_ID = '1f68621a-d07b-476b-87cc-26de71473a3c';

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{projectId: string, environmentId: string, environmentName: 'staging'}}
 */
export function assertRailwayStaging(env) {
  if (env.RAILWAY_PROJECT_ID !== EXPECTED_PROJECT_ID) {
    throw new Error('RAILWAY_SCOPE_MISMATCH: unexpected project');
  }
  if (env.RAILWAY_ENVIRONMENT_NAME !== 'staging') {
    throw new Error('RAILWAY_SCOPE_MISMATCH: production and unknown environments are forbidden');
  }
  if (!env.RAILWAY_ENVIRONMENT_ID) {
    throw new Error('RAILWAY_SCOPE_MISMATCH: staging environment ID is required');
  }
  return {
    projectId: EXPECTED_PROJECT_ID,
    environmentId: env.RAILWAY_ENVIRONMENT_ID,
    environmentName: 'staging',
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const scope = assertRailwayStaging(process.env);
    console.log(JSON.stringify({check:'railway-staging-scope',ok:true, ...scope}));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'RAILWAY_SCOPE_MISMATCH');
    process.exitCode = 1;
  }
}
