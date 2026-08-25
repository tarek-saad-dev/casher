'use client';

import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import type { OperationalSession, SessionUser, BusinessDay, ActiveShift } from '@/lib/session-types';
import { getPermissions } from '@/lib/permissions';
import type { UserAccess } from '@/lib/permissions-types';
import type {
  BootstrapBranch,
  OperationalBootstrap,
} from '@/modules/operations/domain/bootstrapTypes';
import {
  mapBootstrapToSessionShapes,
  shouldSkipBootstrapRevalidate,
} from '@/lib/operations/bootstrapClient';
import { viewMatchesOperational } from '@/lib/operations/viewOperationalState';
import { syncViewBranchCookie } from '@/lib/branch/postSwitchClient';

export type SessionActiveBranch = {
  branchId: number;
  branchCode: string;
  branchName: string;
  shortName: string | null;
};

interface SessionContextValue extends OperationalSession {
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  hasActiveDay: boolean;
  /** True when the user can operate the viewed branch (view == operational OPEN shift). */
  hasActiveShift: boolean;
  /** True when the user has any OPEN ShiftSession, regardless of ViewBranch. */
  hasOpenShift: boolean;
  viewMatchesOperational: boolean;
  defaultShiftId: number | null;
  /** Compatibility alias of viewBranch. */
  activeBranch: SessionActiveBranch | null;
  viewBranch: SessionActiveBranch | null;
  operationalBranch: SessionActiveBranch | null;
  branches: BootstrapBranch[];
  access: UserAccess | null;
  revision: string | null;
  stale: boolean;
  needsRollover: boolean;
  expectedBusinessDate: string | null;
  reconciliationError: string | null;
  operational: OperationalBootstrap['operational'] | null;
  refresh: () => Promise<OperationalBootstrap | null>;
  logout: () => Promise<void>;
  setUser: (user: SessionUser & { defaultShiftId?: number }) => void;
  openMyShift: (shiftId?: number) => Promise<void>;
  closeMyShift: (shiftMoveId?: number) => Promise<void>;
  handoffMyShift: (args: { targetBranchId: number; shiftId: number }) => Promise<void>;
}

export const SessionContext = createContext<SessionContextValue>({
  user: null,
  day: null,
  shift: null,
  permissions: [],
  loading: true,
  error: null,
  isAuthenticated: false,
  hasActiveDay: false,
  hasActiveShift: false,
  hasOpenShift: false,
  viewMatchesOperational: false,
  defaultShiftId: null,
  activeBranch: null,
  viewBranch: null,
  operationalBranch: null,
  branches: [],
  access: null,
  revision: null,
  stale: false,
  needsRollover: false,
  expectedBusinessDate: null,
  reconciliationError: null,
  operational: null,
  refresh: async () => null,
  logout: async () => {},
  setUser: () => {},
  openMyShift: async () => {},
  closeMyShift: async () => {},
  handoffMyShift: async () => {},
});

function accessFromBootstrap(data: OperationalBootstrap): UserAccess {
  return {
    userID: data.user.userId,
    userName: data.user.userName,
    userLevel: data.user.userLevel,
    roles: data.access.roles,
    isSuperAdmin: data.access.isSuperAdmin,
    isPartnerOnly: data.access.isPartnerOnly,
    defaultLandingPath: data.access.defaultLandingPath,
    allowedPagePaths: data.access.allowedPagePaths,
    allowedPageKeys: data.access.allowedPageKeys,
  };
}

export default function SessionProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [user, setUserState] = useState<SessionUser | null>(null);
  const [day, setDay] = useState<BusinessDay | null>(null);
  const [shift, setShift] = useState<ActiveShift | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [defaultShiftId, setDefaultShiftId] = useState<number | null>(null);
  const [activeBranch, setActiveBranch] = useState<SessionActiveBranch | null>(null);
  const [viewBranch, setViewBranch] = useState<SessionActiveBranch | null>(null);
  const [operationalBranch, setOperationalBranch] = useState<SessionActiveBranch | null>(null);
  const [branches, setBranches] = useState<BootstrapBranch[]>([]);
  const [access, setAccess] = useState<UserAccess | null>(null);
  const [revision, setRevision] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [needsRollover, setNeedsRollover] = useState(false);
  const [expectedBusinessDate, setExpectedBusinessDate] = useState<string | null>(null);
  const [reconciliationError, setReconciliationError] = useState<string | null>(null);
  const [operational, setOperational] = useState<OperationalBootstrap['operational'] | null>(null);

  const inFlightRef = useRef<Promise<OperationalBootstrap | null> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastStartedAtRef = useRef<number | null>(null);
  const revisionRef = useRef<string | null>(null);

  const applyBootstrap = useCallback((data: OperationalBootstrap, opts?: { force?: boolean }) => {
    if (!opts?.force && revisionRef.current === data.revision) return;
    revisionRef.current = data.revision;
    const mapped = mapBootstrapToSessionShapes(data);
    setUserState(mapped.user);
    setDay(mapped.day);
    setShift(mapped.shift);
    setPermissions(data.permissions);
    setDefaultShiftId(data.user.defaultShiftId);
    setActiveBranch(mapped.activeBranch);
    setViewBranch(mapped.viewBranch);
    setOperationalBranch(mapped.operationalBranch);
    setBranches(data.branches);
    setAccess(accessFromBootstrap(data));
    setRevision(data.revision);
    setStale(data.stale);
    setNeedsRollover(data.needsRollover);
    setExpectedBusinessDate(data.expectedBusinessDate);
    setReconciliationError(data.reconciliationError);
    setOperational(data.operational);
    setError(null);
  }, []);

  const clearState = useCallback(() => {
    revisionRef.current = null;
    setUserState(null);
    setDay(null);
    setShift(null);
    setPermissions([]);
    setDefaultShiftId(null);
    setActiveBranch(null);
    setViewBranch(null);
    setOperationalBranch(null);
    setBranches([]);
    setAccess(null);
    setRevision(null);
    setStale(false);
    setNeedsRollover(false);
    setExpectedBusinessDate(null);
    setReconciliationError(null);
    setOperational(null);
  }, []);

  const refreshInternal = useCallback(async (opts?: { force?: boolean }): Promise<OperationalBootstrap | null> => {
    if (!opts?.force) {
      if (inFlightRef.current) return inFlightRef.current;
      if (shouldSkipBootstrapRevalidate(lastStartedAtRef.current)) {
        return null;
      }
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    lastStartedAtRef.current = Date.now();

    const pending = (async () => {
      try {
        const res = await fetch('/api/operations/bootstrap', {
          cache: 'no-store',
          credentials: 'same-origin',
          signal: ac.signal,
        });
        if (ac.signal.aborted) return null;
        if (res.status === 401 || res.status === 403) {
          clearState();
          return null;
        }
        if (!res.ok) {
          setError('تعذر تحميل حالة التشغيل');
          return null;
        }
        const data = (await res.json()) as OperationalBootstrap;
        applyBootstrap(data);
        return data;
      } catch (err) {
        if (ac.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
          return null;
        }
        setError('تعذر تحميل حالة التشغيل');
        return null;
      } finally {
        if (!ac.signal.aborted) {
          setLoading(false);
        }
        if (inFlightRef.current === pending) {
          inFlightRef.current = null;
        }
      }
    })();

    inFlightRef.current = pending;
    return pending;
  }, [applyBootstrap, clearState]);

  const refresh = useCallback(
    () => refreshInternal({ force: true }),
    [refreshInternal],
  );

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/session', { method: 'DELETE' });
    } catch {
      // ignore
    }
    clearState();
    window.location.href = '/login';
  }, [clearState]);

  const setUser = useCallback((u: SessionUser & { defaultShiftId?: number }) => {
    setShift(null);
    setDay(null);
    setOperational(null);
    const view = u.ActiveBranchID != null
      ? {
          branchId: u.ActiveBranchID,
          branchCode: u.ActiveBranchCode,
          branchName: u.ActiveBranchCode,
          shortName: null,
        }
      : null;
    setActiveBranch(view);
    setViewBranch(view);
    setOperationalBranch(null);
    setUserState({
      UserID: u.UserID,
      UserName: u.UserName,
      UserLevel: u.UserLevel,
      ActiveBranchID: u.ActiveBranchID,
      ActiveBranchCode: u.ActiveBranchCode,
      BranchSessionVersion: u.BranchSessionVersion ?? 1,
    });
    setPermissions(getPermissions(u.UserLevel));
    setDefaultShiftId(u.defaultShiftId ?? null);
  }, []);

  const openMyShift = useCallback(async (shiftId?: number) => {
    if (!user) throw new Error('No user');

    if (
      operationalBranch &&
      viewBranch &&
      operationalBranch.branchId !== viewBranch.branchId
    ) {
      throw new Error('استخدم نقل الوردية للفرع المعروض — لا يمكن فتح وردية ثانية');
    }

    const targetShiftId = shiftId || defaultShiftId;
    if (!targetShiftId) throw new Error('No shift selected');

    const res = await fetch('/api/shift/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shiftID: targetShiftId }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to open shift');
    }

    lastStartedAtRef.current = null;
    await refreshInternal({ force: true });
  }, [user, defaultShiftId, operationalBranch, viewBranch, refreshInternal]);

  const closeMyShift = useCallback(async (shiftMoveId?: number) => {
    if (!user) throw new Error('No user');
    if (!shift && !shiftMoveId) throw new Error('No open shift');

    const targetShiftMoveId = shiftMoveId || shift?.ID;
    if (!targetShiftMoveId) throw new Error('No shift move ID');

    const res = await fetch('/api/shift/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shiftMoveID: targetShiftMoveId }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to close shift');
    }

    setShift(null);
    lastStartedAtRef.current = null;
    await refreshInternal({ force: true });
  }, [user, shift, refreshInternal]);

  const handoffMyShift = useCallback(async (args: { targetBranchId: number; shiftId: number }) => {
    if (!user) throw new Error('No user');
    const res = await fetch('/api/operations/shift/handoff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetBranchId: args.targetBranchId,
        shiftId: args.shiftId,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'فشل نقل الوردية');
    }
    lastStartedAtRef.current = null;
    if (data.bootstrap) {
      applyBootstrap(data.bootstrap as OperationalBootstrap);
      const boot = data.bootstrap as OperationalBootstrap;
      const viewId = boot.view?.branch?.branchId ?? boot.activeBranch.branchId;
      if (viewId !== args.targetBranchId) {
        revisionRef.current = null;
        const synced = await syncViewBranchCookie(args.targetBranchId);
        if (synced.ok) {
          await refreshInternal({ force: true });
        }
      }
      return;
    }
    await refreshInternal({ force: true });
  }, [user, applyBootstrap, refreshInternal]);

  useEffect(() => {
    if (pathname === '/login') {
      setLoading(false);
      return;
    }
    void refreshInternal({ force: true });
  }, [pathname, refreshInternal]);

  useEffect(() => {
    const revalidate = () => {
      if (document.visibilityState === 'hidden') return;
      if (window.location.pathname === '/login') return;
      void refreshInternal();
    };
    const onOnline = () => {
      if (window.location.pathname === '/login') return;
      lastStartedAtRef.current = null;
      void refreshInternal({ force: true });
    };
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', revalidate);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', revalidate);
      window.removeEventListener('online', onOnline);
    };
  }, [refreshInternal]);

  const matchesOperational = viewMatchesOperational(
    viewBranch?.branchId,
    operationalBranch?.branchId,
  );
  const hasOpenShift =
    !!user &&
    !!shift &&
    shift.Status === true &&
    shift.UserID === user.UserID;

  const contextValue = useMemo(() => ({
    user,
    day,
    shift,
    permissions,
    loading,
    error,
    isAuthenticated: !!user,
    hasActiveDay: !!day && day.Status === true,
    hasOpenShift,
    viewMatchesOperational: matchesOperational,
    hasActiveShift: hasOpenShift && matchesOperational,
    defaultShiftId,
    activeBranch,
    viewBranch,
    operationalBranch,
    branches,
    access,
    revision,
    stale,
    needsRollover,
    expectedBusinessDate,
    reconciliationError,
    operational,
    refresh,
    logout,
    setUser,
    openMyShift,
    closeMyShift,
    handoffMyShift,
  }), [
    user, day, shift, permissions, loading, error, defaultShiftId, activeBranch,
    viewBranch, operationalBranch, branches, access, revision, stale, needsRollover,
    expectedBusinessDate, reconciliationError, operational, hasOpenShift, matchesOperational,
    refresh, logout, setUser, openMyShift, closeMyShift, handoffMyShift,
  ]);

  return (
    <SessionContext.Provider value={contextValue}>
      {children}
    </SessionContext.Provider>
  );
}
