/** Server-only NextCRM installation configuration.
 * Keep the Railway contract centralized so every Field integration uses
 * the same installation identity.
 */
export function getNextcrmInstanceKey(): string {
  return process.env.CISNE_NEXTCRM_INSTANCE_KEY?.trim() ?? '';
}
