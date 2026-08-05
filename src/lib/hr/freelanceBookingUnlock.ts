/**
 * Freelance booking unlock — when a freelance (or attendance-exempt) barber
 * is marked Present/Late/EarlyLeave for a date, treat that date as a working
 * day for booking / operations availability.
 *
 * Pure helpers + one batch DB loader shared by availability engines.
 */

import type { Transaction } from 'mssql';
import { getPool, sql } from '@/lib/db';
import { resolveIsFreelance } from '@/lib/hr/attendance-eligibility';
import { normalizeEmploymentType } from '@/lib/hr/employee-hr-model';
import { isPayableAttendanceStatus } from '@/lib/payroll/dailyPayrollHrRules';

/** Salon-wide fallback when freelance has no defaults and no check-in/out. */
export const FREELANCE_BOOKING_FALLBACK_START = '10:00';
export const FREELANCE_BOOKING_FALLBACK_END = '22:00';

export type FreelanceUnlockWindow = {
  start: string;
  end: string;
  attendanceStatus: string;
  checkInTime: string | null;
  checkOutTime: string | null;
};

function boolish(value: boolean | number | null | undefined): boolean {
  return value === true || value === 1;
}

/** Normalize "HH:MM" / "HH:MM:SS" / SQL TIME-ish string → "HH:MM" or null. */
export function normalizeFreelanceHhmm(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function isFreelanceBookingUnlockStatus(
  status: string | null | undefined,
): boolean {
  return isPayableAttendanceStatus(status);
}

/**
 * Resolve the working window used once a freelance day is unlocked.
 * Prefer HR defaults, then attendance times.
 * Returns null when hours are not configured — callers must deny with
 * FREELANCER_HOURS_NOT_CONFIGURED (do not invent salon-wide hours).
 */
export function resolveFreelanceWorkingWindow(input: {
  checkInTime?: string | null;
  checkOutTime?: string | null;
  defaultStart?: string | null;
  defaultEnd?: string | null;
}): { start: string; end: string } | null {
  const start =
    normalizeFreelanceHhmm(input.defaultStart) ??
    normalizeFreelanceHhmm(input.checkInTime);
  const end =
    normalizeFreelanceHhmm(input.defaultEnd) ??
    normalizeFreelanceHhmm(input.checkOutTime);

  if (!start || !end || start === end) {
    return null;
  }

  return { start, end };
}

/** @deprecated Prefer resolveFreelanceWorkingWindow — kept for tests expecting legacy fallback. */
export function resolveFreelanceWorkingWindowWithFallback(input: {
  checkInTime?: string | null;
  checkOutTime?: string | null;
  defaultStart?: string | null;
  defaultEnd?: string | null;
}): { start: string; end: string } {
  return (
    resolveFreelanceWorkingWindow(input) ?? {
      start: FREELANCE_BOOKING_FALLBACK_START,
      end: FREELANCE_BOOKING_FALLBACK_END,
    }
  );
}

export function shouldUnlockFreelanceForBooking(input: {
  employmentType?: string | null;
  isAttendanceExempt?: boolean | number | null;
  attendanceStatus?: string | null;
  hasExplicitDayOff?: boolean;
}): boolean {
  if (input.hasExplicitDayOff) return false;
  const employmentType = normalizeEmploymentType(input.employmentType);
  const isFreelance = resolveIsFreelance(
    employmentType,
    boolish(input.isAttendanceExempt),
  );
  if (!isFreelance) return false;
  return isFreelanceBookingUnlockStatus(input.attendanceStatus);
}

/**
 * Batch-load unlock windows for empIds on dateStr.
 * Only returns entries that should unlock booking that day.
 * Explicit day-off is caller-side (pass hasExplicitDayOff when filtering).
 */
/**
 * Load freelance booking unlock windows for employees on a date.
 * Phase 2.5: optional `transaction` binds reads to the caller context.
 * When on a Transaction, queries run sequentially (mssql: one request per connection).
 */
export async function loadFreelanceBookingUnlocks(
  empIds: number[],
  dateStr: string,
  options?: { excludeEmpIds?: Set<number>; transaction?: Transaction },
): Promise<Map<number, FreelanceUnlockWindow>> {
  const result = new Map<number, FreelanceUnlockWindow>();
  if (!empIds.length) return result;

  const exclude = options?.excludeEmpIds;
  const ids = exclude
    ? empIds.filter((id) => !exclude.has(id))
    : empIds;
  if (!ids.length) return result;

  const transaction = options?.transaction;
  const db = (transaction ?? (await getPool())) as Awaited<ReturnType<typeof getPool>>;
  const onTx = !!transaction;
  const idList = ids.join(',');

  try {
    const empSql = `
        SELECT
          EmpID,
          EmploymentType,
          IsAttendanceExempt,
          CASE WHEN DefaultCheckInTime  IS NOT NULL THEN LEFT(CONVERT(VARCHAR(8), DefaultCheckInTime,  108), 5) ELSE NULL END AS DefaultCheckInTime,
          CASE WHEN DefaultCheckOutTime IS NOT NULL THEN LEFT(CONVERT(VARCHAR(8), DefaultCheckOutTime, 108), 5) ELSE NULL END AS DefaultCheckOutTime
        FROM dbo.TblEmp
        WHERE EmpID IN (${idList})
      `;
    const attSql = `
        SELECT
          EmpID,
          Status,
          CASE WHEN CheckInTime  IS NOT NULL THEN LEFT(CONVERT(VARCHAR(8), CheckInTime,  108), 5) ELSE NULL END AS CheckInTime,
          CASE WHEN CheckOutTime IS NOT NULL THEN LEFT(CONVERT(VARCHAR(8), CheckOutTime, 108), 5) ELSE NULL END AS CheckOutTime
        FROM dbo.TblEmpAttendance
        WHERE EmpID IN (${idList}) AND WorkDate = @workDate
      `;

    let empRes: { recordset: any[] };
    let attRes: { recordset: any[] };
    if (onTx) {
      empRes = await db.request().query(empSql);
      attRes = await db.request().input('workDate', sql.Date, dateStr).query(attSql);
    } else {
      [empRes, attRes] = await Promise.all([
        db.request().query(empSql),
        db.request().input('workDate', sql.Date, dateStr).query(attSql),
      ]);
    }

    const attByEmp = new Map<number, {
      Status: string | null;
      CheckInTime: string | null;
      CheckOutTime: string | null;
    }>();
    for (const row of attRes.recordset) {
      attByEmp.set(row.EmpID as number, {
        Status: row.Status ?? null,
        CheckInTime: row.CheckInTime ?? null,
        CheckOutTime: row.CheckOutTime ?? null,
      });
    }

    for (const emp of empRes.recordset) {
      const empId = emp.EmpID as number;
      const att = attByEmp.get(empId);
      if (!shouldUnlockFreelanceForBooking({
        employmentType: emp.EmploymentType,
        isAttendanceExempt: emp.IsAttendanceExempt,
        attendanceStatus: att?.Status ?? null,
        hasExplicitDayOff: false,
      })) {
        continue;
      }

      const window = resolveFreelanceWorkingWindow({
        checkInTime: att?.CheckInTime ?? null,
        checkOutTime: att?.CheckOutTime ?? null,
        defaultStart: emp.DefaultCheckInTime ?? null,
        defaultEnd: emp.DefaultCheckOutTime ?? null,
      });
      if (!window) {
        // Attendance present but hours not configured — still record unlock marker
        // with empty times so day-plan can emit FREELANCER_HOURS_NOT_CONFIGURED.
        result.set(empId, {
          start: '',
          end: '',
          attendanceStatus: att!.Status as string,
          checkInTime: att?.CheckInTime ?? null,
          checkOutTime: att?.CheckOutTime ?? null,
        });
        continue;
      }

      result.set(empId, {
        start: window.start,
        end: window.end,
        attendanceStatus: att!.Status as string,
        checkInTime: att?.CheckInTime ?? null,
        checkOutTime: att?.CheckOutTime ?? null,
      });
    }
  } catch {
    /* optional columns / tables — non-fatal */
  }

  return result;
}
