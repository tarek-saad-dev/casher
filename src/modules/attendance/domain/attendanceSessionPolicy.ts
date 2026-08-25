/**
 * Central attendance session classifier + active-OPEN invariant.
 *
 * ACTIVE_OPEN: CheckIn set, CheckOut null, WorkDate == candidate WorkDate
 * STALE_OPEN:  CheckIn set, CheckOut null, WorkDate != candidate WorkDate
 *
 * Invariant: at most one ACTIVE_OPEN per employee globally for a given WorkDate.
 * STALE_OPEN never blocks a new check-in and is never auto-closed here.
 */

export type AttendanceSessionKind =
  | 'ACTIVE_OPEN'
  | 'STALE_OPEN'
  | 'CLOSED'
  | 'NO_SESSION'
  | 'CONFLICT';

export type OpenAttendanceSession = {
  attendanceId: number;
  employeeId: number;
  branchId: number;
  workDate: string;
  checkInTime: string | null;
};

export const ACTIVE_SESSION_LOCK_PREFIX = 'attendance-active-session:' as const;

export function activeSessionLockResource(empId: number): string {
  return `${ACTIVE_SESSION_LOCK_PREFIX}${Number(empId)}`;
}

export function ymdWorkDate(value: unknown): string {
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    // Prefer Cairo-facing string when already YYYY-MM-DD-ish from SQL
    const iso = value.toISOString().slice(0, 10);
    return iso || `${y}-${m}-${d}`;
  }
  return String(value ?? '').slice(0, 10);
}

export function classifyOpenSession(
  sessionWorkDate: unknown,
  candidateWorkDate: string,
): 'ACTIVE_OPEN' | 'STALE_OPEN' {
  return ymdWorkDate(sessionWorkDate) === ymdWorkDate(candidateWorkDate)
    ? 'ACTIVE_OPEN'
    : 'STALE_OPEN';
}

export type ActiveSessionEvaluation = {
  allowed: boolean;
  kind: AttendanceSessionKind;
  conflict: OpenAttendanceSession | null;
  activeSessions: OpenAttendanceSession[];
  staleSessions: OpenAttendanceSession[];
};

/**
 * Decide whether creating/reopening an OPEN session is allowed.
 * excludeAttendanceId: the row being updated (same-branch same-date upsert).
 */
export function evaluateActiveOpenCreation(input: {
  candidateWorkDate: string;
  openSessions: OpenAttendanceSession[];
  excludeAttendanceId?: number | null;
}): ActiveSessionEvaluation {
  const candidate = ymdWorkDate(input.candidateWorkDate);
  const activeSessions: OpenAttendanceSession[] = [];
  const staleSessions: OpenAttendanceSession[] = [];

  for (const session of input.openSessions) {
    if (classifyOpenSession(session.workDate, candidate) === 'STALE_OPEN') {
      staleSessions.push(session);
      continue;
    }
    if (
      input.excludeAttendanceId != null &&
      session.attendanceId === Number(input.excludeAttendanceId)
    ) {
      continue;
    }
    activeSessions.push(session);
  }

  if (activeSessions.length === 0) {
    return {
      allowed: true,
      kind: staleSessions.length ? 'STALE_OPEN' : 'NO_SESSION',
      conflict: null,
      activeSessions,
      staleSessions,
    };
  }

  return {
    allowed: false,
    kind: 'CONFLICT',
    conflict: activeSessions[0] ?? null,
    activeSessions,
    staleSessions,
  };
}

/** True when resulting punches would be OPEN (check-in set, check-out null). */
export function willResultInOpenSession(
  checkInTime: string | null | undefined,
  checkOutTime: string | null | undefined,
): boolean {
  const hasIn = checkInTime != null && String(checkInTime).trim() !== '';
  const hasOut = checkOutTime != null && String(checkOutTime).trim() !== '';
  return hasIn && !hasOut;
}
