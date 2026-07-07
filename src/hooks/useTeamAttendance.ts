'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  getAttendanceDateStr,
  teamAttendanceToMap,
  type TeamAttendanceMember,
} from '@/lib/teamAttendance';

const REFRESH_MS = 60_000;

export function useTeamAttendance() {
  const [team, setTeam] = useState<TeamAttendanceMember[]>([]);
  const [date, setDate] = useState(getAttendanceDateStr);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const fetchingRef = useRef(false);

  const fetchTeam = useCallback(async (silent = false) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    if (!silent) setLoading(true);
    setError('');

    const targetDate = getAttendanceDateStr();
    setDate(targetDate);

    try {
      const res = await fetch(`/api/pos/team-attendance?date=${targetDate}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `خطأ ${res.status}`);
      }
      const data = await res.json();
      setTeam(Array.isArray(data.team) ? data.team : []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'خطأ في تحميل الحضور';
      setError(msg);
      setTeam([]);
    } finally {
      fetchingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTeam();
  }, [fetchTeam]);

  useEffect(() => {
    const id = window.setInterval(() => void fetchTeam(true), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [fetchTeam]);

  useEffect(() => {
    const onFocus = () => void fetchTeam(true);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchTeam]);

  const attendanceMap = useMemo(() => teamAttendanceToMap(team), [team]);

  return {
    team,
    date,
    loading,
    error,
    attendanceMap,
    refresh: () => fetchTeam(false),
  };
}
