'use client';

import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { OperationalSession, SessionUser, BusinessDay, ActiveShift } from '@/lib/session-types';
import { getPermissions } from '@/lib/permissions';

export type SessionActiveBranch = {
  branchId: number;
  branchCode: string;
  branchName: string;
  shortName: string | null;
};

interface SessionContextValue extends OperationalSession {
  loading: boolean;
  isAuthenticated: boolean;
  hasActiveDay: boolean;
  hasActiveShift: boolean;
  defaultShiftId: number | null;
  activeBranch: SessionActiveBranch | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: SessionUser & { defaultShiftId?: number }) => void;
  openMyShift: (shiftId?: number) => Promise<void>;
  closeMyShift: (shiftMoveId?: number) => Promise<void>;
}

export const SessionContext = createContext<SessionContextValue>({
  user: null,
  day: null,
  shift: null,
  permissions: [],
  loading: true,
  isAuthenticated: false,
  hasActiveDay: false,
  hasActiveShift: false,
  defaultShiftId: null,
  activeBranch: null,
  refresh: async () => {},
  logout: async () => {},
  setUser: () => {},
  openMyShift: async () => {},
  closeMyShift: async () => {},
});

export default function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<SessionUser | null>(null);
  const [day, setDay] = useState<BusinessDay | null>(null);
  const [shift, setShift] = useState<ActiveShift | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [defaultShiftId, setDefaultShiftId] = useState<number | null>(null);
  const [activeBranch, setActiveBranch] = useState<SessionActiveBranch | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session', {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!res.ok) {
        // Route Handler may have cleared an invalid/legacy cookie (401).
        setUserState(null);
        setDay(null);
        setShift(null);
        setPermissions([]);
        setActiveBranch(null);
        return;
      }
      const data = await res.json();
      setUserState(data.user || null);
      setDay(data.day || null);
      setShift(data.shift || null);
      setPermissions(data.permissions || []);
      // /api/auth/session returns PascalCase branch fields (BranchID, BranchCode, ...);
      // normalize to the camelCase SessionActiveBranch shape consumed from context.
      setActiveBranch(
        data.activeBranch
          ? {
              branchId: data.activeBranch.BranchID,
              branchCode: data.activeBranch.BranchCode,
              branchName: data.activeBranch.BranchName,
              shortName: data.activeBranch.ShortName ?? null,
            }
          : null,
      );
    } catch {
      // Silent — will retry on next refresh
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/session', { method: 'DELETE' });
    } catch {
      // ignore
    }
    setUserState(null);
    setDay(null);
    setShift(null);
    setPermissions([]);
    setDefaultShiftId(null);
    setActiveBranch(null);
    window.location.href = '/login';
  }, []);

  const setUser = useCallback((u: SessionUser & { defaultShiftId?: number }) => {
    // Clear stale shift/day immediately to prevent previous user's data leaking
    setShift(null);
    setDay(null);
    setActiveBranch(
      u.ActiveBranchID != null
        ? {
            branchId: u.ActiveBranchID,
            branchCode: u.ActiveBranchCode,
            branchName: u.ActiveBranchCode,
            shortName: null,
          }
        : null,
    );
    setUserState({
      UserID: u.UserID,
      UserName: u.UserName,
      UserLevel: u.UserLevel,
      ActiveBranchID: u.ActiveBranchID,
      ActiveBranchCode: u.ActiveBranchCode,
      BranchSessionVersion: u.BranchSessionVersion ?? 1,
    });
    // Temporary client-side map until /api/auth/session refresh returns authoritative RBAC.
    setPermissions(getPermissions(u.UserLevel));
    setDefaultShiftId(u.defaultShiftId ?? null);
  }, []);

  const openMyShift = useCallback(async (shiftId?: number) => {
    if (!user) throw new Error('No user');

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

    await refresh();
  }, [user, defaultShiftId, refresh]);

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
    await refresh();
  }, [user, shift, refresh]);

  // Fetch session on mount
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Refresh session every 60s to catch day/shift changes
  useEffect(() => {
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  // Memoize context value to prevent unnecessary re-renders
  const contextValue = useMemo(() => ({
    user,
    day,
    shift,
    permissions,
    loading,
    isAuthenticated: !!user,
    hasActiveDay: !!day && day.Status === true,
    hasActiveShift: !!user && !!shift && shift.Status === true && shift.UserID === user.UserID,
    defaultShiftId,
    activeBranch,
    refresh,
    logout,
    setUser,
    openMyShift,
    closeMyShift,
  }), [user, day, shift, permissions, loading, defaultShiftId, activeBranch, refresh, logout, setUser, openMyShift, closeMyShift]);

  return (
    <SessionContext.Provider value={contextValue}>
      {children}
    </SessionContext.Provider>
  );
}
