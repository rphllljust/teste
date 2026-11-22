'use client';

import type { ReactNode } from 'react';

type Props = {
  activePage: string;
  group: string;
  onNavigate: (name: string) => void;
  children: ReactNode;
};

/**
 * Global module layout. Module-specific headers, lifecycle progress and commands
 * belong to the actual workspace, not to a generic shell that invents a stage.
 * Preserve the content boundary and existing styles without duplicating chrome.
 */
export function EnterpriseModuleWorkspace({ activePage, children }: Props) {
  return <section className="cisne-module-workspace" aria-label={`Área de trabalho: ${activePage}`}>
    <div className="cisne-module-workspace-body">
      <div className="cisne-module-workspace-content">{children}</div>
    </div>
  </section>;
}
