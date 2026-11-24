'use client';

import { useCallback, useMemo, type ReactNode } from 'react';
import { ToastProvider, useToast } from '@/components/ui/toast';

/**
 * Operational success toasts (day/shift actions). Kept for existing callers;
 * now backed by the app-wide toast system in `@/components/ui/toast`, so new
 * code should call `useToast()` directly.
 */
export function useOperationalToast() {
  const { toast } = useToast();
  const showToast = useCallback(
    (message: string) => {
      toast({ tone: 'success', title: message, duration: 3200 });
    },
    [toast],
  );
  return useMemo(() => ({ showToast }), [showToast]);
}

export function OperationalToastProvider({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
