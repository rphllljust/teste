/** Server-only NextCRM installation configuration. */
export function getNextcrmInstanceKey(): string {
  return process.env.CISNE_NEXTCRM_INSTANCE_KEY?.trim() ?? '';
}
