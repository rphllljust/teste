type ProfileValue = string | null | undefined;

/** Return only changed CRM properties; null remains an explicit request to clear a mapped value. */
export function changedProfileFields(
  fieldNames: readonly string[],
  current: Readonly<Record<string, ProfileValue>>,
  previous: Readonly<Record<string, ProfileValue>> = {},
): Record<string, string | null> {
  const changes: Record<string, string | null> = {};
  for (const name of fieldNames) {
    const currentValue = current[name] ?? null;
    const previousValue = previous[name] ?? null;
    if (currentValue !== previousValue) changes[name] = currentValue;
  }
  return changes;
}
