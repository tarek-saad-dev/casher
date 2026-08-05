/**
 * availabilityEngine.ts
 *
 * Single source of truth for barber working-hour and availability logic.
 *
 * Replaces all ad-hoc copies of:
 *   - sqlTimeToDate (server-local) in available-days/route.ts
 *   - timeToMinutes / withinWindow scattered across 3+ files
 *   - BARBER_JOBS filter duplicated in 5+ files
 *   - Schedule + override + dayoff logic independently duplicated
 *
 * Timezone contract: ALL times are Africa/Cairo wall-clock.
 * SQL DATE/TIME columns are normalised here — never passed as raw JS Date
 * with toISOString() which shifts UTC midnight dates by -2/-3 hours.
 *
 * DayOfWeek: 0 = Sunday … 6 = Saturday (JS Date.getDay() + TblEmpWorkSchedule convention).
 */

import { getPool, sql } from "@/lib/db";
import { salonDateTimeToMs } from "@/lib/publicBookingHelpers";
import {
  applyOverrides,
  EffectiveSchedule,
  ScheduleOverride,
} from "@/lib/scheduleOverrides";
import { loadBookingOverridesForDate } from "@/lib/hr/attendance-shift-schedule-sync";
// loadFreelanceBookingUnlocks removed from day-status path (canonical day plan).

export const SALON_TZ = "Africa/Cairo";

// ── Barber job titles treated as "bookable" ────────────────────────────────────
/** Working barbers + assistants (queue / schedule roster). */
export const BARBER_JOB_VALUES = ["حلاق", "مساعد", "Barber", "barber"] as const;
export const BARBER_JOBS_SQL_LIST = BARBER_JOB_VALUES.map((j) => `N'${j}'`).join(", ");

/**
 * Appointment / "nearest barber" slots — lead barbers only (no assistants).
 * Matches flow-board Job = حلاق.
 */
export const BOOKING_SLOT_BARBER_JOB_VALUES = ["حلاق", "Barber", "barber"] as const;
export const BOOKING_SLOT_BARBER_JOBS_SQL_LIST = BOOKING_SLOT_BARBER_JOB_VALUES.map(
  (j) => `N'${j}'`,
).join(", ");

// ── Debug flag ─────────────────────────────────────────────────────────────────
const DEBUG_AVAIL = process.env.DEBUG_AVAILABILITY === "true";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface BarberSchedule {
  isWorkingDay: boolean;
  start: string | null;  // "HH:MM" | null
  end:   string | null;  // "HH:MM" | null
  source: "TblEmpWorkSchedule" | "TblEmpBranchWorkSchedule" | "TblEmpTemporaryBranchTransfer" | "TblEmp.Default" | "freelance_attendance" | "none";
}

export interface AttendanceInfo {
  status: string | null;       // "Present" | "Late" | "Absent" | "DayOff" | null (not recorded)
  checkInTime:  string | null; // "HH:MM" or null
  checkOutTime: string | null; // "HH:MM" or null
  scheduledStartTime?: string | null;
  scheduledEndTime?: string | null;
  lateMinutes:  number;
  earlyLeaveMinutes: number;
}

export interface BarberDayStatus {
  empId:    number;
  dateStr:  string;  // "YYYY-MM-DD"

  // Schedule
  schedule:        BarberSchedule;
  effectiveSchedule: EffectiveSchedule;

  // Day-level flags
  isDayOff:        boolean;  // TblEmpDayOff or day_off override or non-working day
  isAbsent:        boolean;  // TblEmpAttendance.Status = 'Absent'
  isLateStart:     boolean;  // active late_start override
  isEarlyLeave:    boolean;  // active early_leave override
  isCustomHours:   boolean;  // active custom_hours override
  isWorkingDay:    boolean;  // effective (after override)

  // Times (effective, after override)
  effectiveStart:  string | null;
  effectiveEnd:    string | null;

  // Attendance (for today only)
  attendance:      AttendanceInfo | null;

  // Override details
  appliedOverride: ScheduleOverride | null;
  dayOffReason:    string | null;

  // Arabic status label for UI
  statusReasonArabic: string;

  // For ops timeline
  currentAvailabilityStatus:
    | "working"
    | "day_off"
    | "absent"
    | "not_checked_in"
    | "off"
    | "unknown";
}

// ── Cairo date/time helpers ────────────────────────────────────────────────────

/** "YYYY-MM-DD" for a Date in Africa/Cairo */
export function cairoDateStr(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: SALON_TZ });
}

/** "HH:MM" for a Date in Africa/Cairo */
export function cairoTimeStr(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SALON_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const h = parts.find((p) => p.type === "hour")?.value ?? "00";
  const m = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${h}:${m}`;
}

/**
 * Convert a SQL TIME value (Date anchored to 1970-01-01 UTC, or "HH:MM:SS" string)
 * to "HH:MM". Never use .getHours() — always use UTC accessors for SQL TIME.
 */
export function sqlTimeToHhmm(val: unknown): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    const h = String(val.getUTCHours()).padStart(2, "0");
    const m = String(val.getUTCMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }
  if (typeof val === "string") {
    const s = val.trim();
    // "HH:MM" or "HH:MM:SS"
    const m = s.match(/^(\d{1,2}):(\d{2})/);
    if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
  }
  return null;
}

/**
 * Convert a SQL DATE column value to "YYYY-MM-DD" safely.
 * SQL DATE columns come back as Date objects at midnight UTC.
 * Using toISOString().slice(0,10) on UTC+2/+3 server shifts the date by -1 day.
 * Instead, we format using the Cairo timezone (or use CONVERT in SQL).
 *
 * For SQL results: prefer using CONVERT(VARCHAR(10), col, 120) in queries.
 * This helper is the JS-side fallback.
 */
export function sqlDateToStr(val: unknown): string | null {
  if (!val) return null;
  if (typeof val === "string") {
    // already "YYYY-MM-DD" or "YYYY-MM-DDTHH..."
    return val.slice(0, 10);
  }
  if (val instanceof Date) {
    // Use UTC parts (SQL DATE is midnight UTC) — this IS correct for SQL DATE.
    // SQL DATE = no time zone. mssql returns it as 2026-06-12T00:00:00.000Z.
    // UTC date = correct calendar date regardless of server TZ.
    const y = val.getUTCFullYear();
    const mo = String(val.getUTCMonth() + 1).padStart(2, "0");
    const d = String(val.getUTCDate()).padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }
  return null;
}

/**
 * Build a full Cairo-normalized Date from a dateStr + SQL TIME value.
 * This replaces all naive new Date(`${dateStr}T${hhmm}:00`) calls.
 */
export function cairoDateTime(dateStr: string, timeVal: unknown): Date {
  const hhmm = sqlTimeToHhmm(timeVal) ?? "00:00";
  return new Date(salonDateTimeToMs(dateStr, hhmm, SALON_TZ));
}

/** "HH:MM" → minutes since midnight */
export function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Is checkMin inside [startMin, endMin), handling overnight windows? */
export function withinWorkingWindow(
  checkMin: number,
  startMin: number,
  endMin: number,
): boolean {
  if (startMin <= endMin) return checkMin >= startMin && checkMin < endMin;
  return checkMin >= startMin || checkMin < endMin;
}

// ── Cairo-safe day-of-week ─────────────────────────────────────────────────────

/** Day of week (0=Sun … 6=Sat) from a "YYYY-MM-DD" string, Cairo-safe. */
export function dowFromDateStr(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00Z`).getDay();
}

// ── Core DB loaders ────────────────────────────────────────────────────────────

/**
 * Load the weekly default schedule for one barber on a given date.
 *
 * Source: TblEmpWorkSchedule ONLY. No fallback to TblEmp.DefaultCheckInTime/Out.
 *
 * @deprecated Phase 2.5 — Legacy / HR / schedule-control preview only.
 * Prefer `resolveEmployeeDayPlan` or `loadWorkingWindowsBatch` for booking/ops availability.
 * Classification: Legacy (production callers limited to scheduleControlPreview).
 *
 * Rules:
 *   - Row found with IsWorkingDay=1 and valid times → working day.
 *   - Row found with IsWorkingDay=1 but NULL times  → invalid, source="invalid_hr_schedule".
 *   - Row found with IsWorkingDay=0                 → scheduled day off.
 *   - No row for this day but other rows exist      → day not configured = not working.
 *   - No rows at all for this employee              → source="missing_hr_schedule".
 */
export async function getDefaultSchedule(
  empId: number,
  dateStr: string,
): Promise<BarberSchedule> {
  const db = await getPool();
  const dow = dowFromDateStr(dateStr);

  try {
    // Query 1: specific day row
    const res = await db
      .request()
      .input("empId", sql.Int, empId)
      .input("dow", sql.TinyInt, dow)
      .query(`
        SELECT TOP 1 IsWorkingDay,
          CASE WHEN StartTime IS NOT NULL THEN LEFT(CONVERT(VARCHAR(8), StartTime, 108), 5) ELSE NULL END AS StartTime,
          CASE WHEN EndTime   IS NOT NULL THEN LEFT(CONVERT(VARCHAR(8), EndTime,   108), 5) ELSE NULL END AS EndTime
        FROM dbo.TblEmpWorkSchedule
        WHERE EmpID = @empId AND DayOfWeek = @dow
      `);

    if (res.recordset.length > 0) {
      const row = res.recordset[0];
      const isWorking = !!row.IsWorkingDay;

      if (isWorking && (!row.StartTime || !row.EndTime)) {
        console.warn(
          `[availabilityEngine] EMP ${empId} / ${dateStr} (dow=${dow}): ` +
          `TblEmpWorkSchedule row has IsWorkingDay=1 but NULL StartTime/EndTime. ` +
          `Fix the HR schedule for this employee.`,
        );
        return { isWorkingDay: false, start: null, end: null, source: "invalid_hr_schedule" as any };
      }

      return {
        isWorkingDay: isWorking,
        start: row.StartTime ?? null,
        end:   row.EndTime   ?? null,
        source: "TblEmpWorkSchedule",
      };
    }

    // Query 2: does this employee have ANY schedule rows?
    const anyRowRes = await db
      .request()
      .input("empId", sql.Int, empId)
      .query(`SELECT TOP 1 1 AS HasRows FROM dbo.TblEmpWorkSchedule WHERE EmpID = @empId`);

    if (anyRowRes.recordset.length > 0) {
      // Has rows for other days but not this day → day not configured = not working
      return { isWorkingDay: false, start: null, end: null, source: "TblEmpWorkSchedule" };
    }

    // No rows at all → missing HR schedule
    console.warn(
      `[availabilityEngine] EMP ${empId} / ${dateStr}: No TblEmpWorkSchedule rows found at all. ` +
      `Configure a weekly schedule in /admin/hr.`,
    );
    return { isWorkingDay: false, start: null, end: null, source: "missing_hr_schedule" as any };
  } catch { /* TblEmpWorkSchedule may not exist yet */ }

  return { isWorkingDay: false, start: null, end: null, source: "none" };
}

/**
 * Load TblEmpDayOff entry for a barber on a specific date.
 * Returns null if no record.
 */
export async function getDayOff(
  empId: number,
  dateStr: string,
): Promise<{ offType: string; reason: string | null } | null> {
  const db = await getPool();
  try {
    const res = await db
      .request()
      .input("empId", sql.Int, empId)
      .input("offDate", sql.Date, dateStr)
      .query(`
        SELECT TOP 1 OffType, Reason
        FROM dbo.TblEmpDayOff
        WHERE EmpID = @empId AND OffDate = @offDate AND IsDeleted = 0
      `);
    if (res.recordset.length > 0) {
      return {
        offType: res.recordset[0].OffType,
        reason: res.recordset[0].Reason ?? null,
      };
    }
  } catch { /* table may not exist */ }
  return null;
}

/**
 * Load attendance record for a barber on a specific date.
 * Only useful for today — do not use for future date availability.
 */
export async function getAttendanceStatus(
  empId: number,
  dateStr: string,
): Promise<AttendanceInfo | null> {
  const db = await getPool();
  try {
    const res = await db
      .request()
      .input("empId", sql.Int, empId)
      .input("workDate", sql.Date, dateStr)
      .query(`
        SELECT
          Status,
          CASE WHEN CheckInTime  IS NOT NULL THEN LEFT(CONVERT(VARCHAR(8), CheckInTime,  108), 5) ELSE NULL END AS CheckInTime,
          CASE WHEN CheckOutTime IS NOT NULL THEN LEFT(CONVERT(VARCHAR(8), CheckOutTime, 108), 5) ELSE NULL END AS CheckOutTime,
          ISNULL(LateMinutes, 0)       AS LateMinutes,
          ISNULL(EarlyLeaveMinutes, 0) AS EarlyLeaveMinutes
        FROM dbo.TblEmpAttendance
        WHERE EmpID = @empId AND WorkDate = @workDate
      `);
    if (res.recordset.length === 0) return null;
    const r = res.recordset[0];
    return {
      status:            r.Status ?? null,
      checkInTime:       r.CheckInTime ?? null,
      checkOutTime:      r.CheckOutTime ?? null,
      lateMinutes:       r.LateMinutes,
      earlyLeaveMinutes: r.EarlyLeaveMinutes,
    };
  } catch {
    return null;
  }
}

/**
 * Load schedule overrides for a barber on a date.
 */
export async function getScheduleOverrides(
  empId: number,
  dateStr: string,
): Promise<ScheduleOverride[]> {
  const db = await getPool();
  const overridesMap = await loadBookingOverridesForDate(db, [empId], dateStr);
  return overridesMap.get(empId) ?? [];
}

/**
 * Build a complete BarberDayStatus for one barber on one date.
 * Phase 2: canonical resolveEmployeeDayPlan (+ optional branchId).
 * Phase 2.5: optional transaction for shared DB context.
 */
export async function getBarberDayStatus(
  empId: number,
  dateStr: string,
  opts?: {
    isToday?: boolean;
    debugEmpId?: number;
    debugDate?: string;
    branchId?: number;
    transaction?: import('mssql').Transaction;
  },
): Promise<BarberDayStatus> {
  const isToday = opts?.isToday ?? (dateStr === cairoDateStr(new Date()));
  const { resolveEmployeeDayPlan } = await import('@/lib/availability/resolveEmployeeDayPlan');
  const { mapEmployeeDayPlanToBarberDayStatus } = await import(
    '@/lib/availability/mapEmployeeDayPlanToBarberDayStatus'
  );
  const plan = await resolveEmployeeDayPlan({
    empId,
    businessDate: dateStr,
    branchId: opts?.branchId ?? null,
    source: 'operations',
    transaction: opts?.transaction,
  });
  const status = mapEmployeeDayPlanToBarberDayStatus({ plan, isToday }) as BarberDayStatus;
  if (DEBUG_AVAIL || (opts?.debugEmpId === empId && opts?.debugDate === dateStr)) {
    console.log('[availabilityEngine] EMP', empId, dateStr, { plan, status, branchId: opts?.branchId ?? null });
  }
  return status;
}

/**
 * Batch-load BarberDayStatus via resolveEmployeeDayPlansBatch (Phase 2).
 * Phase 2.5: optional transaction for shared DB context.
 */
export async function getBarbersDayStatus(
  empIds: number[],
  dateStr: string,
  opts?: {
    isToday?: boolean;
    debugEmpId?: number;
    debugDate?: string;
    branchId?: number;
    transaction?: import('mssql').Transaction;
  },
): Promise<Map<number, BarberDayStatus>> {
  if (!empIds.length) return new Map();
  const isToday = opts?.isToday ?? (dateStr === cairoDateStr(new Date()));
  const { resolveEmployeeDayPlansBatch } = await import('@/lib/availability/resolveEmployeeDayPlan');
  const { mapEmployeeDayPlanToBarberDayStatus } = await import(
    '@/lib/availability/mapEmployeeDayPlanToBarberDayStatus'
  );
  const plans = await resolveEmployeeDayPlansBatch({
    empIds,
    businessDate: dateStr,
    branchId: opts?.branchId ?? null,
    source: 'operations',
    transaction: opts?.transaction,
  });
  const result = new Map<number, BarberDayStatus>();
  for (const empId of empIds) {
    const plan = plans.get(empId);
    if (!plan) continue;
    const status = mapEmployeeDayPlanToBarberDayStatus({ plan, isToday }) as BarberDayStatus;
    if (DEBUG_AVAIL || (opts?.debugEmpId === empId && opts?.debugDate === dateStr)) {
      console.log('[availabilityEngine BATCH] EMP', empId, dateStr, { plan, status, branchId: opts?.branchId ?? null });
    }
    result.set(empId, status);
  }
  return result;
}

// ── Availability check (single barber, single slot) ───────────────────────────

/**
 * Check if a barber is available to accept a booking/queue slot.
 *
 * For any work date: also checks attendance (Absent = unavailable).
 * Returns { available, reason } where reason is an Arabic string.
 */
export async function checkBarberAvailableAt(
  empId: number,
  startDateTime: Date,
  endDateTime: Date,
  opts?: { debugEmpId?: number; debugDate?: string; branchId?: number },
): Promise<{ available: boolean; reason: string; statusReasonArabic: string }> {
  const dateStr = cairoDateStr(startDateTime);
  const isToday = dateStr === cairoDateStr(new Date());
  const status = await getBarberDayStatus(empId, dateStr, {
    isToday,
    branchId: opts?.branchId,
    debugEmpId: opts?.debugEmpId,
    debugDate: opts?.debugDate,
  });

  if (!status.isWorkingDay) {
    return {
      available: false,
      reason: status.statusReasonArabic,
      statusReasonArabic: status.statusReasonArabic,
    };
  }

  if (status.isAbsent) {
    return { available: false, reason: "غائب", statusReasonArabic: "غائب" };
  }

  // Check block_range overrides
  const startMs = startDateTime.getTime();
  const endMs   = endDateTime.getTime();
  for (const iv of status.effectiveSchedule.blockedIntervals) {
    if (startMs < iv.endMs && endMs > iv.startMs) {
      return {
        available: false,
        reason: iv.reason ?? "النطاق الزمني محجوب",
        statusReasonArabic: iv.reason ?? "النطاق الزمني محجوب",
      };
    }
  }

  // Check within working window
  if (status.effectiveStart && status.effectiveEnd) {
    const startMin   = hhmmToMin(cairoTimeStr(startDateTime));
    const endMin     = hhmmToMin(cairoTimeStr(endDateTime));
    const shiftStart = hhmmToMin(status.effectiveStart);
    const shiftEnd   = hhmmToMin(status.effectiveEnd);

    if (!withinWorkingWindow(startMin, shiftStart, shiftEnd)) {
      const reason = `خارج ساعات العمل (${status.effectiveStart} - ${status.effectiveEnd})`;
      return { available: false, reason, statusReasonArabic: reason };
    }
  }

  return { available: true, reason: "متاح", statusReasonArabic: "متاح" };
}
