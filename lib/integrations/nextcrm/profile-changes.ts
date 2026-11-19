export type EditableNextcrmProfile = {
  officePhone: string | null;
  website: string | null;
  fax: string | null;
  email: string | null;
  companyId: string | null;
  vat: string | null;
  billingStreet: string | null;
  billingPostalCode: string | null;
  billingCity: string | null;
  billingState: string | null;
  billingCountry: string | null;
  shippingStreet: string | null;
  shippingPostalCode: string | null;
  shippingCity: string | null;
  shippingState: string | null;
  shippingCountry: string | null;
  description: string | null;
  annualRevenue: string | null;
  memberOf: string | null;
  industry: string | null;
  pricelistId: string | null;
  status: string | null;
  type: string | null;
};

export type EditableNextcrmForm = {
  [K in keyof EditableNextcrmProfile]: string;
};

/** Sends only rendered fields whose normalized value changed.
 * An empty rendered field is an intentional clear; fields not rendered by the
 * form cannot appear in the patch and therefore remain untouched upstream.
 */
export function changedNextcrmProfileFields(
  before: EditableNextcrmProfile,
  form: EditableNextcrmForm,
): Partial<Record<keyof EditableNextcrmProfile, string | null>> {
  const result: Partial<Record<keyof EditableNextcrmProfile, string | null>> = {};
  for (const name of Object.keys(form) as Array<keyof EditableNextcrmProfile>) {
    const next = form[name].trim() || null;
    if ((before[name] ?? null) !== next) result[name] = next;
  }
  return result;
}
