import { formatTime12h } from '@/lib/timeUtils';

/** Same calendar-date logic as /admin/attendance page */
export function getAttendanceDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface TeamAttendanceMember {
  employeeId: number;
  employeeName: string;
  jobTitle: string | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  attendanceStatus: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  isCheckedIn: boolean;
  isCheckedOut: boolean;
  lateMinutes: number;
  notes: string;
}

export type AttendanceDisplayKind =
  | 'present'
  | 'not_checked_in'
  | 'checked_out'
  | 'absent'
  | 'day_off'
  | 'excused';

export interface AttendanceDisplay {
  kind: AttendanceDisplayKind;
  chipLabel: string;
  badgeLabel: string;
  statusLabel: string;
  chipClassName: string;
  badgeClassName: string;
}

export function deriveAttendanceDisplay(member: TeamAttendanceMember): AttendanceDisplay {
  const { attendanceStatus, checkInTime, checkOutTime } = member;
  const inFmt = checkInTime ? formatTime12h(checkInTime) : null;
  const outFmt = checkOutTime ? formatTime12h(checkOutTime) : null;

  if (attendanceStatus === 'DayOff') {
    return {
      kind: 'day_off',
      chipLabel: 'إجازة',
      badgeLabel: 'إجازة',
      statusLabel: 'إجازة',
      chipClassName: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
      badgeClassName: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
    };
  }

  if (attendanceStatus === 'Absent') {
    return {
      kind: 'absent',
      chipLabel: 'غائب',
      badgeLabel: 'غائب',
      statusLabel: 'غائب',
      chipClassName: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
      badgeClassName: 'bg-rose-500/15 text-rose-400 border-rose-500/25',
    };
  }

  if (attendanceStatus === 'Excused') {
    return {
      kind: 'excused',
      chipLabel: 'إذن',
      badgeLabel: 'إذن',
      statusLabel: 'إذن / بعذر',
      chipClassName: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
      badgeClassName: 'bg-purple-500/15 text-purple-400 border-purple-500/25',
    };
  }

  if (checkInTime && checkOutTime && outFmt) {
    return {
      kind: 'checked_out',
      chipLabel: `انصرف ${outFmt}`,
      badgeLabel: 'انصرف',
      statusLabel: 'انصرف',
      chipClassName: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
      badgeClassName: 'bg-violet-500/15 text-violet-300 border-violet-500/25',
    };
  }

  if (checkInTime && inFmt) {
    return {
      kind: 'present',
      chipLabel: `حاضر منذ ${inFmt}`,
      badgeLabel: 'حاضر',
      statusLabel: 'حاضر الآن',
      chipClassName: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
      badgeClassName: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
    };
  }

  return {
    kind: 'not_checked_in',
    chipLabel: 'لم يحضر',
    badgeLabel: 'لم يحضر',
    statusLabel: attendanceStatus === 'Pending' ? 'لم يسجل' : 'لم يحضر',
    chipClassName: 'bg-amber-500/10 text-amber-200/80 border-amber-500/25',
    badgeClassName: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/25',
  };
}

export function teamAttendanceToMap(team: TeamAttendanceMember[]): Map<number, TeamAttendanceMember> {
  return new Map(team.map(m => [m.employeeId, m]));
}
