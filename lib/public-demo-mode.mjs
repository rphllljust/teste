/**
 * Public demo mode is deliberately a two-key server-side opt-in.
 * It can only be enabled by a Railway administrator in the staging environment.
 * Production and local environments always use the authenticated workspace.
 */
export function isPublicDemoModeEnabled(
  environmentName = process.env.RAILWAY_ENVIRONMENT_NAME,
  configuredMode = process.env.CISNE_PUBLIC_DEMO_MODE,
) {
  return environmentName === "staging" && configuredMode === "true";
}
