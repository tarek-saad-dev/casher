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
  const {
    isAuthenticated,
    day,
    needsRollover,
    expectedBusinessDate,
    stale,
    refresh,
  } = useSession();

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

  const isSkippedToday = useCallback(() => {
    const skipUntil = localStorage.getItem(SKIP_STORAGE_KEY);
    if (!skipUntil) return false;
    return Date.now() < parseInt(skipUntil, 10);
  }, []);

  const check = useCallback(async () => {
    if (!isAuthenticated) return;

    if (!needsRollover && !stale) {
      setState({
        needsRollover: false,
        hasOpenDay: !!day,
        openDayDate: day ? new Date(day.NewDay).toISOString().split('T')[0] : null,
        todayDate: expectedBusinessDate ?? null,
        openShifts: [],
        loading: false,
      });
      hasTriggeredRef.current = false;
      setShowModal(false);
      return;
    }

    setState((s) => ({ ...s, loading: true }));
    try {
      const res = await fetch('/api/day/rollover-check');
      if (!res.ok) {
        setState((s) => ({
          ...s,
          needsRollover: true,
          hasOpenDay: !!day,
          openDayDate: day ? new Date(day.NewDay).toISOString().split('T')[0] : null,
          todayDate: expectedBusinessDate ?? null,
          loading: false,
        }));
        return;
      }
      const data = await res.json();

      setState({
        needsRollover: data.needsRollover,
        hasOpenDay: data.hasOpenDay,
        openDayDate: data.openDayDate,
        todayDate: data.todayDate,
        openShifts: data.openShifts || [],
        loading: false,
      });

      if (data.needsRollover && Date.now() > dismissedUntilRef.current && !isSkippedToday()) {
        if (!hasTriggeredRef.current) {
          setShowModal(true);
          hasTriggeredRef.current = true;
        }
      }

      if (!data.needsRollover) {
        hasTriggeredRef.current = false;
        setShowModal(false);
      }
    } catch {
      setState((s) => ({ ...s, loading: false }));
    }
  }, [isAuthenticated, needsRollover, stale, day, expectedBusinessDate, isSkippedToday]);

  const dismiss = useCallback(() => {
    setShowModal(false);
    dismissedUntilRef.current = Date.now() + DISMISS_COOLDOWN_MS;
    setTimeout(() => {
      hasTriggeredRef.current = false;
      void refresh().then(() => check());
    }, DISMISS_COOLDOWN_MS);
  }, [check, refresh]);

  const skip = useCallback(() => {
    setShowModal(false);
    const skipUntil = Date.now() + SKIP_COOLDOWN_MS;
    localStorage.setItem(SKIP_STORAGE_KEY, skipUntil.toString());
    dismissedUntilRef.current = skipUntil;
    setTimeout(() => {
      hasTriggeredRef.current = false;
      void refresh().then(() => check());
    }, SKIP_COOLDOWN_MS);
  }, [check, refresh]);

  const resolved = useCallback(() => {
    setShowModal(false);
    hasTriggeredRef.current = false;
    dismissedUntilRef.current = 0;
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      void check();
    }
  }, [isAuthenticated, needsRollover, stale, check]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 5, 0);
    const msUntilMidnight = midnight.getTime() - now.getTime();

    const timer = setTimeout(() => {
      hasTriggeredRef.current = false;
      void refresh();
    }, msUntilMidnight);

    return () => clearTimeout(timer);
  }, [isAuthenticated, refresh]);

  return {
    ...state,
    showModal,
    dismiss,
    skip,
    resolved,
    recheck: check,
  };
}
