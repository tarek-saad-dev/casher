'use client';

import { useEffect, useRef } from 'react';

/**
 * Shared modal chrome: body scroll lock, Escape close, return-focus, initial dialog focus.
 * Used by Queue modals. Booking workspace mirrors the same Escape/return-focus rules
 * inside useBookingWorkspace (Escape blocked while submitting).
 */
export function useOpsModalChrome(args: {
  open: boolean;
  onClose: () => void;
  /** When false, Escape does not close (e.g. mutation in flight). */
  allowEscape?: boolean;
}) {
  const { open, onClose, allowEscape = true } = args;
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const id = window.requestAnimationFrame(() => {
      dialogRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(id);
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && allowEscape) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, allowEscape, onClose]);

  useEffect(() => {
    if (!open && returnFocusRef.current) {
      returnFocusRef.current.focus();
      returnFocusRef.current = null;
    }
  }, [open]);

  return { dialogRef };
}

/** Pure helper for Phase E tests — Escape must not close while a mutation is active. */
export function opsModalAllowsEscape(submitting: boolean): boolean {
  return !submitting;
}
