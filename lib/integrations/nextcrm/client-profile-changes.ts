export const nextcrmEditableFields = [
  'officePhone', 'website', 'fax', 'email', 'billingStreet',
  'billingPostalCode', 'billingCity', 'billingState', 'billingCountry',
  'shippingStreet', 'shippingPostalCode', 'shippingCity',
  'shippingState', 'shippingCountry', 'description', 'annualRevenue',
  'memberOf', 'vat', 'companyId',
] as const;

export type NextcrmEditableField = typeof nextcrmEditableFields[number];

/** Only submitted and modified fields may be sent to the CRM bridge. */
export function collectNextcrmChanges(
  form: FormData,
  current: Partial<Record<NextcrmEditableField, string | null>>,
): Record<string, string | null> {
  const changes: Record<string, string | null> = {};
  for (const field of nextcrmEditableFields) {
    if (!form.has(field)) continue;
    const raw = String(form.get(field) ?? '');
    if (raw === (current[field] ?? '')) continue;
    changes[field] = raw.trim() || null;
  }
  return changes;
}
