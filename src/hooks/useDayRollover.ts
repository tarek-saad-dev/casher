'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from './useSession';

interface OpenShiftInfo {
  ID: number;
  UserID: number;
  UserName: string;
  ShiftID: number;
  ShiftName: string;
  StartTime: string;
}

interface RolloverState {
  needsRollover: boolean;
  hasOpenDay: boolean;
  openDayDate: string | null;
  todayDate: string | null;
  openShifts: OpenShiftInfo[];
  loading: boolean;
}

const DISMISS_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes
const SKIP_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const SKIP_STORAGE_KEY = 'dayRolloverSkippedUntil';

export function useDayRollover() {
  const { isAuthenticated, day } = useSession();

  const [state, setState] = useState<RolloverState>({
    needsRollover: false,
    hasOpenDay: false,
    openDayDate: null,
    todayDate: null,
    openShifts: [],
    loading: false,
  });

  const [showModal, setShowModal] = useState(false);
  const dismissedUntilRef = useRef<number>(0);
  const hasTriggeredRef = useRef(false);

  const check = useCallback(async () => {
    if (!isAuthenticated) return;

    setState((s) => ({ ...s, loading: true }));
    try {
      const res = await fetch('/api/day/rollover-check');
      if (!res.ok) return;
      const data = await res.json();

      setState({
        needsRollover: data.needsRollover,
        hasOpenDay: data.hasOpenDay,
        openDayDate: data.openDayDate,
        todayDate: data.todayDate,
        openShifts: data.openShifts || [],
        loading: false,
      });

      // Show modal if stale and not dismissed recently and not skipped today
      if (data.needsRollover && Date.now() > dismissedUntilRef.current && !isSkippedToday()) {
        if (!hasTriggeredRef.current) {
          setShowModal(true);
          hasTriggeredRef.current = true;
        }
      }

      // If resolved, reset trigger flag
      if (!data.needsRollover) {
        hasTriggeredRef.current = false;
        setShowModal(false);
      }
    } catch {
      setState((s) => ({ ...s, loading: false }));
    }
  }, [isAuthenticated]);

  // Dismiss with cooldown
  const dismiss = useCallback(() => {
    setShowModal(false);
    dismissedUntilRef.current = Date.now() + DISMISS_COOLDOWN_MS;
    // Schedule re-check after cooldown
    setTimeout(() => {
      hasTriggeredRef.current = false;
      check();
    }, DISMISS_COOLDOWN_MS);
  }, [check]);

  // Skip with cooldown (reappear after 5 minutes)
  const skip = useCallback(() => {
    setShowModal(false);
    const skipUntil = Date.now() + SKIP_COOLDOWN_MS;
    localStorage.setItem(SKIP_STORAGE_KEY, skipUntil.toString());
    dismissedUntilRef.current = skipUntil;
    // Schedule re-check after cooldown
    setTimeout(() => {
      hasTriggeredRef.current = false;
      check();
    }, SKIP_COOLDOWN_MS);
  }, [check]);

  // Check if skip cooldown is still active
  const isSkippedToday = useCallback(() => {
    const skipUntil = localStorage.getItem(SKIP_STORAGE_KEY);
    if (!skipUntil) return false;
    return Date.now() < parseInt(skipUntil, 10);
  }, []);

  // After successful resolution
  const resolved = useCallback(() => {
    setShowModal(false);
    hasTriggeredRef.current = false;
    dismissedUntilRef.current = 0;
  }, []);

  // Check on mount
  useEffect(() => {
    if (isAuthenticated) {
      check();
    }
  }, [isAuthenticated, check]);

  // Re-check whenever session day changes (from 60s refresh)
  useEffect(() => {
    if (isAuthenticated && day) {
      const dayDate = new Date(day.NewDay).toISOString().split('T')[0];
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      if (dayDate < todayStr && Date.now() > dismissedUntilRef.current && !isSkippedToday()) {
        if (!hasTriggeredRef.current) {
          setShowModal(true);
          hasTriggeredRef.current = true;
        }
      }
    }
  }, [isAuthenticated, day, isSkippedToday]);

  // Midnight timer — schedule a check at next midnight
  useEffect(() => {
    if (!isAuthenticated) return;

    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 5, 0); // 5 seconds after midnight
    const msUntilMidnight = midnight.getTime() - now.getTime();

    const timer = setTimeout(() => {
      hasTriggeredRef.current = false;
      check();
    }, msUntilMidnight);

    return () => clearTimeout(timer);
  }, [isAuthenticated, check]);

  return {
    ...state,
    showModal,
    dismiss,
    skip,
    resolved,
    recheck: check,
  };
}
