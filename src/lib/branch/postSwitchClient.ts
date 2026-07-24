/**
 * Client helpers for Phase 1H branch session switching.
 * Full document navigation is mandatory after a successful switch.
 */
'use client';

import { invalidateRecentInvoicesCache } from '@/lib/recentInvoicesCache';
import { resolvePostSwitchNavigationPath } from '@/lib/branch/postSwitchNavigation';

export type ClientSwitchableBranch = {
  branchId: number;
  branchCode: string;
  branchName: string;
  shortName: string | null;
  isCurrent: boolean;
};

export type ClientActiveBranch = {
  branchId: number;
  branchCode: string;
  branchName: string;
  shortName: string | null;
};

/** Clear known in-memory branch-owned caches before hard navigation. */
export function clearClientBranchOwnedState(): void {
  try {
    invalidateRecentInvoicesCache();
  } catch {
    // ignore
  }
}

/**
 * Confirm before discarding unsaved work when a page exposes a dirty marker.
 * Uses existing registries when present; otherwise a lightweight beforeunload-style check.
 */
export function confirmDiscardUnsavedWorkIfNeeded(): boolean {
  if (typeof window === 'undefined') return true;
  const dirty =
    (window as unknown as { __posUnsavedForms?: number }).__posUnsavedForms ?? 0;
  if (dirty > 0) {
    return window.confirm('هناك تغييرات غير محفوظة. هل تريد المتابعة وتجاهلها؟');
  }
  return true;
}

export async function fetchSwitchableBranches(): Promise<{
  ok: boolean;
  activeBranch: ClientActiveBranch | null;
  branches: ClientSwitchableBranch[];
  error?: string;
}> {
  const res = await fetch('/api/auth/branches', {
    cache: 'no-store',
    credentials: 'same-origin',
  });
  if (!res.ok) {
    return { ok: false, activeBranch: null, branches: [], error: 'UNAUTHORIZED' };
  }
  const data = await res.json();
  return {
    ok: Boolean(data.ok),
    activeBranch: data.activeBranch ?? null,
    branches: Array.isArray(data.branches) ? data.branches : [],
  };
}

/**
 * Switch branch via Route Handler, then hard-navigate.
 * Never updates UI labels optimistically before server success.
 */
export async function performBranchSwitch(args: {
  branchId: number;
  currentPathname?: string | null;
}): Promise<{ ok: true; changed: boolean } | { ok: false; error: string; message: string }> {
  if (!confirmDiscardUnsavedWorkIfNeeded()) {
    return { ok: false, error: 'CANCELLED', message: 'تم الإلغاء' };
  }

  const res = await fetch('/api/auth/switch-branch', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ branchId: args.branchId }),
  });

  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok || !data.ok) {
    return {
      ok: false,
      error: String(data.error || 'SWITCH_FAILED'),
      message: String(data.message || 'فشل تبديل الفرع'),
    };
  }

  clearClientBranchOwnedState();

  const target = resolvePostSwitchNavigationPath(args.currentPathname);
  // Mandatory full document navigation — do not use router.refresh() alone.
  window.location.assign(target);
  return { ok: true, changed: Boolean(data.changed) };
}
