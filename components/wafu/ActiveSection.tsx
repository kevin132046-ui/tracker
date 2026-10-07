'use client';

import type { ReactNode } from 'react';
import { useSyncExternalStore } from 'react';

/**
 * Which page section is on screen (side nav, guide bar, home bar). Kept outside the page component:
 * scrolling past a section re-renders only the navigation, not the whole page with its holdings grid.
 */
export type PageSection = 'overview' | 'positions' | 'returns' | 'valuation';

let current: PageSection = 'overview';
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function setActiveSection(next: PageSection) {
  if (next === current) return;
  current = next;
  listeners.forEach((listener) => listener());
}

export const useActiveSection = () => useSyncExternalStore(subscribe, () => current, () => 'overview' as PageSection);

/** Renders its children with the current section; only this part updates while scrolling. */
export function ActiveSection({ children }: { children: (section: PageSection) => ReactNode }) {
  return <>{children(useActiveSection())}</>;
}
