'use client';

import { useSyncExternalStore } from 'react';

/**
 * Subscribe to a CSS media query. `serverValue` is used during SSR and the
 * first hydration pass (pick the layout most users get on that screen).
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined') return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}
