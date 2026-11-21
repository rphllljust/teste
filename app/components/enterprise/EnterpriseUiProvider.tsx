'use client';

import { useRef, useState, type ReactNode } from 'react';
import { FluentProvider, createLightTheme, createDOMRenderer, RendererProvider, renderToStyleElements } from '@fluentui/react-components';
import { useServerInsertedHTML } from 'next/navigation';

const cisneBrand = {
  10: '#061f20', 20: '#063c3c', 30: '#075a5b', 40: '#087e81', 50: '#099194',
  60: '#23a4a5', 70: '#4db8b7', 80: '#78ccca', 90: '#a6dfdc', 100: '#c9ebe7',
  110: '#d7efed', 120: '#e1f4f2', 130: '#e8f7f6', 140: '#effafa', 150: '#f6fcfb', 160: '#fbfefe',
} as const;

export const cisneFluentTheme = createLightTheme(cisneBrand);

/** Griffel's documented App Router registry: keep one renderer per request and emit CSS once. */
export function EnterpriseUiProvider({ children }: { children: ReactNode }) {
  const [renderer] = useState(() => createDOMRenderer());
  const didRender = useRef(false);

  useServerInsertedHTML(() => {
    if (didRender.current) return;
    didRender.current = true;
    return <>{renderToStyleElements(renderer)}</>;
  });

  return <RendererProvider renderer={renderer}><FluentProvider theme={cisneFluentTheme}>{children}</FluentProvider></RendererProvider>;
}
