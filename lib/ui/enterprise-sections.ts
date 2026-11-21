export type EnterpriseSectionReference = { id: string };

/** Keep a selected anchor when it exists; otherwise point navigation at the new object's first section. */
export function resolveActiveSectionId(
  sections: readonly EnterpriseSectionReference[],
  selectedId: string,
): string {
  return sections.some((section) => section.id === selectedId)
    ? selectedId
    : sections[0]?.id ?? '';
}
