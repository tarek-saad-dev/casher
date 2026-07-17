'use client';

import { useCallback, useEffect, useState } from 'react';

export type NavMode = 'legacy' | 'tree';

const STORAGE_KEY = 'pos-nav-mode';
const EVENT = 'pos-nav-mode-change';
const DEFAULT_MODE: NavMode = 'tree';

function readMode(): NavMode {
  if (typeof window === 'undefined') return DEFAULT_MODE;
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === 'tree' || v === 'legacy' ? v : DEFAULT_MODE;
}

/**
 * Navigation layout preference: legacy flat sections vs. new MAIN → SUB → items tree.
 * Persisted in localStorage and synced across components/tabs.
 */
export function useNavMode() {
  const [mode, setModeState] = useState<NavMode>(DEFAULT_MODE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setModeState(readMode());
    setHydrated(true);

    const sync = () => setModeState(readMode());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const setMode = useCallback((next: NavMode) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, next);
    window.dispatchEvent(new Event(EVENT));
    setModeState(next);
  }, []);

  const toggle = useCallback(() => {
    setMode(readMode() === 'tree' ? 'legacy' : 'tree');
  }, [setMode]);

  return { mode, setMode, toggle, hydrated };
}
