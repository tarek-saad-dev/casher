/**
 * Client helpers for view-branch session switching.
 * Cookie change only — never mutates ShiftSession / TblShiftMove.
 */
'use client';

import { invalidateRecentInvoicesCache } from '@/lib/recentInvoicesCache';
import {
  needsHardNavigationAfterViewSwitch,
  resolvePostSwitchNavigationPath,
} from '@/lib/branch/postSwitchNavigation';
import { setViewBranchSwitchUi } from '@/lib/branch/viewBranchSwitchUi';

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

/** Clear known in-memory branch-owned caches before a view-branch switch. */
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

export async function syncViewBranchCookie(
  branchId: number,
): Promise<{ ok: boolean; changed?: boolean; error?: string; message?: string }> {
  const res = await fetch('/api/auth/switch-branch', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ branchId }),
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
      message: String(data.message || 'فشل تبديل الفرع المعروض'),
    };
  }

  clearClientBranchOwnedState();
  return { ok: true, changed: Boolean(data.changed) };
}

/**
 * Soft-refreshes bootstrap/read context when the current route is compatible.
 * Hard-navigates only for branch-owned entity URLs.
 * Never opens, closes, or hands off a shift.
 */
export async function performBranchSwitch(args: {
  branchId: number;
  currentPathname?: string | null;
  targetLabel?: string | null;
  onSoftSwitch?: () => Promise<void>;
}): Promise<
  | { ok: true; changed: boolean; navigation: 'hard' | 'soft' }
  | { ok: false; error: string; message: string }
> {
  if (!confirmDiscardUnsavedWorkIfNeeded()) {
    return { ok: false, error: 'CANCELLED', message: 'تم الإلغاء' };
  }

  setViewBranchSwitchUi(true, args.targetLabel ?? null);
  let keepLoadingVisible = false;
  try {
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
    const needsHard = needsHardNavigationAfterViewSwitch(args.currentPathname);

    if (needsHard || !args.onSoftSwitch) {
      keepLoadingVisible = true;
      window.location.assign(target);
      return { ok: true, changed: Boolean(data.changed), navigation: 'hard' };
    }

    await args.onSoftSwitch();
    return { ok: true, changed: Boolean(data.changed), navigation: 'soft' };
  } finally {
    if (!keepLoadingVisible) {
      setViewBranchSwitchUi(false);
    }
  }
}
