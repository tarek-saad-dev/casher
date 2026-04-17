'use client';

import { createContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import type { OperationalSession, SessionUser, BusinessDay, ActiveShift } from '@/lib/session-types';
import { getPermissions } from '@/lib/permissions';

interface SessionContextValue extends OperationalSession {
  loading: boolean;
  isAuthenticated: boolean;
  hasActiveDay: boolean;
  hasActiveShift: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: SessionUser) => void;
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
  refresh: async () => {},
  logout: async () => {},
  setUser: () => {},
});

export default function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<SessionUser | null>(null);
  const [day, setDay] = useState<BusinessDay | null>(null);
  const [shift, setShift] = useState<ActiveShift | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session');
      if (!res.ok) return;
      const data = await res.json();
      setUserState(data.user || null);
      setDay(data.day || null);
      setShift(data.shift || null);
      setPermissions(data.permissions || []);
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
    window.location.href = '/login';
  }, []);

  const setUser = useCallback((u: SessionUser) => {
    // Clear stale shift/day immediately to prevent previous user's data leaking
    setShift(null);
    setDay(null);
    setUserState(u);
    setPermissions(getPermissions(u.UserLevel));
  }, []);

  // Fetch session on mount
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Refresh session every 60s to catch day/shift changes
  useEffect(() => {
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <SessionContext.Provider
      value={{
        user,
        day,
        shift,
        permissions,
        loading,
        isAuthenticated: !!user,
        hasActiveDay: !!day && day.Status === true,
        hasActiveShift: !!user && !!shift && shift.Status === true && shift.UserID === user.UserID,
        refresh,
        logout,
        setUser,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}
