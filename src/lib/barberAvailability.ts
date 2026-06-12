/**
 * barberAvailability.ts
 * Server-side utility for barber availability checks.
 *
 * Source of truth (existing HR tables — do NOT duplicate):
 *   dbo.TblEmpWorkSchedule  — per-day schedule (IsWorkingDay, StartTime, EndTime)
 *   dbo.TblEmpDayOff        — specific date off records (OffDate, OffType, IsDeleted)
 *   dbo.TblEmp.Job          — 'حلاق' / 'مساعد' identifies barbers (no EmpCatID column)
 *
 * DayOfWeek: 0=Sunday … 6=Saturday (JS Date.getDay() convention, matches TblEmpWorkSchedule)
 * Overnight shifts (e.g. StartTime=12:00, EndTime=02:00) are supported.
 */

import { getPool, sql } from '@/lib/db';
import { applyOverrides, loadOverridesForDate } from '@/lib/scheduleOverrides';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BarberAvailability {
  EmpID:              number;
  EmpName:            string;
  Job:                string | null;
  IsAvailable:        boolean;
  AvailabilityReason: string;
  WorkingStartTime:   string | null;
  WorkingEndTime:     string | null;
}

/** Job values treated as barbers */
const BARBER_JOBS = [`N'حلاق'`, `N'مساعد'`, `N'Barber'`, `N'barber'`];
const BARBER_JOBS_SQL = BARBER_JOBS.join(', ');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Parse "HH:MM" or "HH:MM:SS" into minutes from midnight */
function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** Format a SQL Time value (string | Date) to "HH:MM" */
function fmtTime(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 5);
  if (v instanceof Date) {
    // mssql returns TIME columns as Date anchored to 1970-01-01 UTC — use UTC accessors
    return `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}`;
  }
  return null;
}

/**
 * Is the given minute-of-day inside the working window?
 * Handles overnight windows (e.g. 12:00→02:00).
 */
function withinWindow(checkMin: number, startMin: number, endMin: number): boolean {
  if (startMin <= endMin) {
    return checkMin >= startMin && checkMin < endMin;
  }
  // Overnight: e.g. start=720 (12:00), end=120 (02:00)
  return checkMin >= startMin || checkMin < endMin;
}

// ── Core availability check ───────────────────────────────────────────────────

/**
 * Check a single barber's availability at a given datetime.
 * Uses existing HR tables: TblEmpWorkSchedule + TblEmpDayOff.
 */
/** Extract "HH:MM" for Africa/Cairo from a Date using Intl (server-TZ independent) */
function cairoHHMM(dt: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(dt);
  const h = parts.find(p => p.type === 'hour')?.value ?? '00';
  const m = parts.find(p => p.type === 'minute')?.value ?? '00';
  return `${h}:${m}`;
}

/** Extract "YYYY-MM-DD" for Africa/Cairo from a Date */
function cairoDateString(dt: Date): string {
  return dt.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

export async function getBarberAvailabilityReason(
  empId: number,
  dt: Date,
): Promise<{ available: boolean; reason: string; startTime: string | null; endTime: string | null }> {
  const db = await getPool();
  // CRITICAL: use Cairo local date/time, not server local time
  // (server may be UTC; salon is Africa/Cairo = UTC+2/+3)
  const dateStr = cairoDateString(dt);
  const cairoTime = cairoHHMM(dt); // "HH:MM" in Cairo local time
  // dayOfWeek from Cairo date (not server-local Date.getDay which uses server TZ)
  const cairoDate = new Date(`${dateStr}T12:00:00Z`);
  const dayOfWeek = cairoDate.getDay(); // 0=Sun…6=Sat, matches TblEmpWorkSchedule

  // 1. Check TblEmpDayOff — specific day off for this date
  try {
    const dayOffRes = await db.request()
      .input('empId',   sql.Int,  empId)
      .input('offDate', sql.Date, dateStr)
      .query(`
        SELECT TOP 1 OffType, Reason
        FROM dbo.TblEmpDayOff
        WHERE EmpID = @empId AND OffDate = @offDate AND IsDeleted = 0
      `);
    if (dayOffRes.recordset.length > 0) {
      const { OffType, Reason } = dayOffRes.recordset[0];
      const typeLabel: Record<string, string> = {
        day_off: 'إجازة', sick: 'إجازة مرضية',
        emergency: 'إجازة طارئة', annual: 'إجازة سنوية',
      };
      const label = typeLabel[OffType] ?? 'إجازة';
      return {
        available: false,
        reason: Reason ? `${label}: ${Reason}` : label,
        startTime: null, endTime: null,
      };
    }
  } catch { /* TblEmpDayOff may not exist yet — non-fatal */ }

  // 2. Check attendance (today only) — Absent barber is unavailable
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  if (dateStr === todayStr) {
    try {
      const attRes = await db.request()
        .input('empId',     sql.Int,  empId)
        .input('workDate',  sql.Date, dateStr)
        .query(`SELECT TOP 1 Status FROM dbo.TblEmpAttendance WHERE EmpID = @empId AND WorkDate = @workDate`);
      if (attRes.recordset[0]?.Status === 'Absent') {
        return { available: false, reason: 'غائب', startTime: null, endTime: null };
      }
    } catch { /* table may not exist */ }
  }

  // 3. Check TblEmpWorkSchedule — weekly per-day schedule
  try {
    const schedRes = await db.request()
      .input('empId',     sql.Int,     empId)
      .input('dayOfWeek', sql.TinyInt, dayOfWeek)
      .query(`
        SELECT TOP 1 IsWorkingDay, StartTime, EndTime, Notes
        FROM dbo.TblEmpWorkSchedule
        WHERE EmpID = @empId AND DayOfWeek = @dayOfWeek
      `);

    if (schedRes.recordset.length === 0) {
      // No schedule row — fall back to TblEmp default times
      const empRes = await db.request()
        .input('empId', sql.Int, empId)
        .query(`
          SELECT CONVERT(VARCHAR(5), DefaultCheckInTime, 108)  AS DefaultCheckInTime,
                 CONVERT(VARCHAR(5), DefaultCheckOutTime, 108) AS DefaultCheckOutTime
          FROM dbo.TblEmp WHERE EmpID = @empId
        `);
      const emp = empRes.recordset[0];
      if (!emp?.DefaultCheckInTime || !emp?.DefaultCheckOutTime) {
        // No schedule and no default times — barber is NOT available (not available by default)
        return { available: false, reason: 'لا يوجد جدول عمل معرّف', startTime: null, endTime: null };
      }
      const startMin = timeToMinutes(emp.DefaultCheckInTime);
      const endMin   = timeToMinutes(emp.DefaultCheckOutTime);
      const checkMin = timeToMinutes(cairoTime);
      if (!withinWindow(checkMin, startMin, endMin)) {
        return {
          available: false,
          reason: `خارج ساعات العمل (${emp.DefaultCheckInTime} - ${emp.DefaultCheckOutTime})`,
          startTime: emp.DefaultCheckInTime,
          endTime:   emp.DefaultCheckOutTime,
        };
      }
      return { available: true, reason: 'متاح', startTime: emp.DefaultCheckInTime, endTime: emp.DefaultCheckOutTime };
    }

    const row = schedRes.recordset[0];
    if (!row.IsWorkingDay) {
      return {
        available: false,
        reason: row.Notes ?? 'إجازة أسبوعية',
        startTime: null, endTime: null,
      };
    }

    const startStr = fmtTime(row.StartTime);
    const endStr   = fmtTime(row.EndTime);

    // 4. Apply schedule overrides
    const overridesMap = await loadOverridesForDate(db, [empId], dateStr);
    const overrides    = overridesMap.get(empId) ?? [];
    if (overrides.length > 0) {
      const base = {
        isWorking: !!row.IsWorkingDay,
        start: startStr ?? '09:00',
        end:   endStr   ?? '23:00',
      };
      const eff = applyOverrides(empId, dateStr, base, overrides);
      if (!eff.isWorking) {
        return {
          available: false,
          reason: eff.appliedOverride?.Reason ?? 'إجازة (تعديل)',
          startTime: null, endTime: null,
        };
      }
      // Check block_range at this specific time
      const checkMs = dt.getTime();
      for (const iv of eff.blockedIntervals) {
        if (checkMs >= iv.startMs && checkMs < iv.endMs) {
          return {
            available: false,
            reason: iv.reason ?? 'النطاق الزمني محجوب',
            startTime: null, endTime: null,
          };
        }
      }
      // Use effective start/end for window check
      const effStartMin = timeToMinutes(eff.start);
      const effEndMin   = timeToMinutes(eff.end);
      const checkMin    = timeToMinutes(cairoTime);
      if (!withinWindow(checkMin, effStartMin, effEndMin)) {
        return {
          available: false,
          reason: `خارج ساعات العمل (${eff.start} - ${eff.end})`,
          startTime: eff.start, endTime: eff.end,
        };
      }
      return { available: true, reason: 'متاح', startTime: eff.start, endTime: eff.end };
    }

    if (startStr && endStr) {
      const startMin = timeToMinutes(startStr);
      const endMin   = timeToMinutes(endStr);
      const checkMin = timeToMinutes(cairoTime);
      if (!withinWindow(checkMin, startMin, endMin)) {
        return {
          available: false,
          reason: `خارج ساعات العمل (${startStr} - ${endStr})`,
          startTime: startStr,
          endTime:   endStr,
        };
      }
    }

    return {
      available: true,
      reason: 'متاح',
      startTime: startStr,
      endTime:   endStr,
    };
  } catch {
    // TblEmpWorkSchedule may not exist yet — unavailable by default (safe fallback)
    return { available: false, reason: 'لا يوجد جدول عمل', startTime: null, endTime: null };
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Return all active barbers (Job IN حلاق/مساعد/Barber) with
 * their availability at the given datetime.
 */
export async function getAvailableBarbers(dt: Date): Promise<BarberAvailability[]> {
  const db = await getPool();

  const empRes = await db.request().query(`
    SELECT EmpID, EmpName, Job
    FROM dbo.TblEmp
    WHERE ISNULL(isActive, 1) = 1
      AND Job IN (${BARBER_JOBS_SQL})
    ORDER BY EmpName
  `);

  const results: BarberAvailability[] = [];
  for (const emp of empRes.recordset) {
    const avail = await getBarberAvailabilityReason(emp.EmpID, dt);
    results.push({
      EmpID:              emp.EmpID,
      EmpName:            emp.EmpName,
      Job:                emp.Job,
      IsAvailable:        avail.available,
      AvailabilityReason: avail.reason,
      WorkingStartTime:   avail.startTime,
      WorkingEndTime:     avail.endTime,
    });
  }
  return results;
}

/**
 * Return only barbers (active, correct Job) — no availability check.
 */
export async function getBarbersOnly(): Promise<Array<{ EmpID: number; EmpName: string; Job: string | null }>> {
  const db = await getPool();
  const res = await db.request().query(`
    SELECT EmpID, EmpName, Job
    FROM dbo.TblEmp
    WHERE ISNULL(isActive, 1) = 1
      AND Job IN (${BARBER_JOBS_SQL})
    ORDER BY EmpName
  `);
  return res.recordset;
}

/**
 * Is this barber working at the given datetime?
 * Convenience wrapper around getBarberAvailabilityReason.
 */
export async function isBarberWorkingAt(empId: number, dt: Date): Promise<boolean> {
  const { available } = await getBarberAvailabilityReason(empId, dt);
  return available;
}

/**
 * Get working window (startTime, endTime) for a barber on a given date.
 * Returns null times if no schedule row exists.
 */
export async function getBarberWorkingWindow(
  empId: number,
  date: Date,
): Promise<{ startTime: string | null; endTime: string | null; isWorkingDay: boolean }> {
  const db = await getPool();
  // Use Cairo local date to derive correct dayOfWeek
  const cairoDs = cairoDateString(date);
  const dayOfWeek = new Date(`${cairoDs}T12:00:00Z`).getDay();
  try {
    const res = await db.request()
      .input('empId',     sql.Int,     empId)
      .input('dayOfWeek', sql.TinyInt, dayOfWeek)
      .query(`
        SELECT TOP 1 IsWorkingDay, StartTime, EndTime
        FROM dbo.TblEmpWorkSchedule
        WHERE EmpID = @empId AND DayOfWeek = @dayOfWeek
      `);
    if (!res.recordset.length) return { startTime: null, endTime: null, isWorkingDay: false };
    const row = res.recordset[0];
    return {
      isWorkingDay: !!row.IsWorkingDay,
      startTime: fmtTime(row.StartTime),
      endTime:   fmtTime(row.EndTime),
    };
  } catch {
    return { startTime: null, endTime: null, isWorkingDay: false };
  }
}
