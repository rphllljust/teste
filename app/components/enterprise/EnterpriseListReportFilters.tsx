'use client';

import type { ReactNode } from 'react';
import { EnterpriseButton } from './EnterprisePrimitives';

type EnterpriseListReportFiltersProps = {
  label: string;
  children: ReactNode;
  count?: number;
  onClear: () => void;
};

/**
 * Search/filter controls in List Reports are deliberately not wrapped in
 * an HTML form: pressing Enter in a search field must never reset filters.
 * API requests remain owned by each domain workspace.
 */
export function EnterpriseListReportFilters({
  label, children, count, onClear,
}: EnterpriseListReportFiltersProps) {
  return (
    <section className="enterprise-list-report-controls" aria-label={label}>
      <div className="enterprise-list-report-filters">{children}</div>
      <div className="enterprise-list-report-controls-end">
        {typeof count === 'number' && <output aria-live="polite">{count} resultado{count === 1 ? '' : 's'}</output>}
        <EnterpriseButton type="button" appearance="subtle" className="secondary" onClick={onClear}>
          Limpar filtros
        </EnterpriseButton>
      </div>
    </section>
  );
}
