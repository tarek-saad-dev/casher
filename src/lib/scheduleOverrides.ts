/**
 * scheduleOverrides.ts
 *
 * Shared logic for TblEmpScheduleOverrides — emergency booking control.
 *
 * Override types:
 *  day_off       – employee is fully unavailable for the day
 *  late_start    – effective shift start becomes StartTime
 *  early_leave   – effective shift end becomes EndTime
 *  custom_hours  – replace entire shift with StartTime/EndTime
 *  block_range   – keep shift boundaries; block [StartTime, EndTime) as an interval
 *
 * All functions are pure helpers that receive pre-loaded override rows so
 * callers can batch-load once and call per-barber without extra DB trips.
 */

import { getPool, sql } from "@/lib/db";
import { salonDateTimeToMs } from "@/lib/publicBookingHelpers";

const SALON_TZ = "Africa/Cairo";

const DEV = process.env.NODE_ENV !== "production";

// ── Types ─────────────────────────────────────────────────────────────────────

export type OverrideType =
  | "day_off"
  | "late_start"
  | "early_leave"
  | "custom_hours"
  | "block_range";

export interface ScheduleOverride {
  OverrideID: number;
  EmpID: number;
  OverrideDate: string; // "YYYY-MM-DD"
  Type: OverrideType;
  StartTime: string | null; // "HH:MM"
  EndTime: string | null; // "HH:MM"
  Reason: string | null;
  IsActive: boolean;
  CreatedAt: string;
  CreatedBy: string | null;
}

export interface BaseSchedule {
  isWorking: boolean;
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}

export interface EffectiveSchedule {
  isWorking: boolean;
  start: string; // "HH:MM"
  end: string; // "HH:MM"
  /** Extra blocked intervals from block_range overrides. Epochs in ms. */
  blockedIntervals: Array<{ startMs: number; endMs: number; reason: string }>;
  /** Which override caused this result (for logging) */
  appliedOverride: ScheduleOverride | null;
}

// ── DB helpers ────────────────────────────────────────────────────────────────

/** Ensure TblEmpScheduleOverrides exists. Safe to call multiple times. */
export async function ensureOverridesTable(
  db: Awaited<ReturnType<typeof getPool>>,
): Promise<void> {
  await db.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'TblEmpScheduleOverrides'
    )
    BEGIN
      CREATE TABLE dbo.TblEmpScheduleOverrides (
        OverrideID  INT           IDENTITY(1,1) PRIMARY KEY,
        EmpID       INT           NOT NULL,
        OverrideDate DATE         NOT NULL,
        Type        NVARCHAR(30)  NOT NULL,
        StartTime   TIME          NULL,
        EndTime     TIME          NULL,
        Reason      NVARCHAR(300) NULL,
        IsActive    BIT           NOT NULL DEFAULT 1,
        CreatedAt   DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy   NVARCHAR(100) NULL,

        CONSTRAINT CK_TblEmpScheduleOverrides_Type CHECK (
          Type IN (N'day_off', N'late_start', N'early_leave', N'custom_hours', N'block_range')
        ),
        CONSTRAINT FK_TblEmpScheduleOverrides_TblEmp
          FOREIGN KEY (EmpID) REFERENCES dbo.TblEmp(EmpID)
      );

      CREATE INDEX IX_TblEmpScheduleOverrides_EmpDate
        ON dbo.TblEmpScheduleOverrides (EmpID, OverrideDate)
        WHERE IsActive = 1;
    END
  `);
}

/**
 * Load all active overrides for a list of barbers on a single date.
 * Returns map: EmpID → ScheduleOverride[]
 */
export async function loadOverridesForDate(
  db: Awaited<ReturnType<typeof getPool>>,
  barberIds: number[],
  dateStr: string, // "YYYY-MM-DD"
): Promise<Map<number, ScheduleOverride[]>> {
  const map = new Map<number, ScheduleOverride[]>();
  if (!barberIds.length) return map;

  try {
    await ensureOverridesTable(db);

    const res = await db
      .request()
      .input("odate", sql.Date, dateStr)
      .query(
        `
        SELECT
          OverrideID, EmpID, CONVERT(VARCHAR(10), OverrideDate, 120) AS OverrideDate,
          Type,
          CASE WHEN StartTime IS NOT NULL
               THEN LEFT(CONVERT(VARCHAR(8), StartTime, 108), 5)
               ELSE NULL END AS StartTime,
          CASE WHEN EndTime IS NOT NULL
               THEN LEFT(CONVERT(VARCHAR(8), EndTime, 108), 5)
               ELSE NULL END AS EndTime,
          Reason, IsActive,
          CONVERT(VARCHAR(30), CreatedAt, 126) AS CreatedAt,
          CreatedBy
        FROM dbo.TblEmpScheduleOverrides
        WHERE EmpID IN (${barberIds.join(",")})
          AND OverrideDate = @odate
          AND IsActive = 1
        ORDER BY EmpID, OverrideID
      `,
      )
      .catch(() => ({ recordset: [] as ScheduleOverride[] }));

    for (const row of res.recordset) {
      const list = map.get(row.EmpID) ?? [];
      list.push(row);
      map.set(row.EmpID, list);
    }
  } catch {
    /* table may not exist yet — return empty map */
  }

  return map;
}

/**
 * Load overrides for a single barber on a date.
 */
export async function loadOverridesForBarber(
  db: Awaited<ReturnType<typeof getPool>>,
  empId: number,
  dateStr: string,
): Promise<ScheduleOverride[]> {
  const map = await loadOverridesForDate(db, [empId], dateStr);
  return map.get(empId) ?? [];
}

// ── Core logic ────────────────────────────────────────────────────────────────

/**
 * Apply overrides to a base schedule and return the effective schedule.
 *
 * Priority (first matching override wins for shift-level types):
 *   1. day_off         → not working
 *   2. custom_hours    → replace start+end
 *   3. late_start      → push start forward
 *   4. early_leave     → pull end backward
 *
 * block_range overrides are additive — all of them produce blocked intervals.
 *
 * Overnight shift awareness:
 *   The effective schedule inherits the overnight flag from the base (or custom_hours).
 *   block_range StartTime/EndTime are placed on the correct epoch using
 *   the same nextDate logic used by available-slots.
 */
export function applyOverrides(
  empId: number,
  dateStr: string,
  baseSchedule: BaseSchedule,
  overrides: ScheduleOverride[],
): EffectiveSchedule {
  const effective: EffectiveSchedule = {
    isWorking: baseSchedule.isWorking,
    start: baseSchedule.start,
    end: baseSchedule.end,
    blockedIntervals: [],
    appliedOverride: null,
  };

  const active = overrides.filter((o) => o.IsActive);
  if (!active.length) return effective;

  // day_off wins over everything
  const dayOff = active.find((o) => o.Type === "day_off");
  if (dayOff) {
    effective.isWorking = false;
    effective.appliedOverride = dayOff;
    if (DEV) {
      console.log("[booking-control override]", {
        empId,
        date: dateStr,
        baseSchedule,
        overrides: active,
        effectiveSchedule: effective,
        blockedIntervals: effective.blockedIntervals,
      });
    }
    return effective;
  }

  // custom_hours replaces start+end entirely
  const custom = active.find((o) => o.Type === "custom_hours");
  if (custom) {
    if (custom.StartTime) effective.start = custom.StartTime;
    if (custom.EndTime) effective.end = custom.EndTime;
    effective.appliedOverride = custom;
  } else {
    // late_start pushes start forward
    const lateStart = active.find((o) => o.Type === "late_start");
    if (lateStart?.StartTime) {
      effective.start = lateStart.StartTime;
      effective.appliedOverride = lateStart;
    }

    // early_leave pulls end backward
    const earlyLeave = active.find((o) => o.Type === "early_leave");
    if (earlyLeave?.EndTime) {
      effective.end = earlyLeave.EndTime;
      effective.appliedOverride = effective.appliedOverride ?? earlyLeave;
    }
  }

  // block_range — all of them, additive
  const blockRanges = active.filter((o) => o.Type === "block_range");
  const isOvernightBase =
    hhmmToMin(effective.end) <= hhmmToMin(effective.start);

  for (const br of blockRanges) {
    if (!br.StartTime || !br.EndTime) continue;

    // Determine correct epoch for start of block range.
    // If block start is in the post-midnight portion of an overnight shift,
    // it belongs to dateStr+1.
    const brStartMin = hhmmToMin(br.StartTime);
    const brEndMin = hhmmToMin(br.EndTime);
    const shiftStartMin = hhmmToMin(effective.start);

    let brStartMs: number;
    let brEndMs: number;

    if (isOvernightBase && brStartMin < shiftStartMin) {
      // Block is in the post-midnight portion (e.g., 00:30 on a 14:00→02:00 shift)
      brStartMs = salonDateTimeToMs(nextDate(dateStr), br.StartTime, SALON_TZ);
    } else {
      brStartMs = salonDateTimeToMs(dateStr, br.StartTime, SALON_TZ);
    }

    if (isOvernightBase && brEndMin <= shiftStartMin) {
      brEndMs = salonDateTimeToMs(nextDate(dateStr), br.EndTime, SALON_TZ);
    } else if (brEndMin <= brStartMin) {
      // block itself crosses midnight
      brEndMs = salonDateTimeToMs(nextDate(dateStr), br.EndTime, SALON_TZ);
    } else {
      brEndMs = salonDateTimeToMs(dateStr, br.EndTime, SALON_TZ);
    }

    effective.blockedIntervals.push({
      startMs: brStartMs,
      endMs: brEndMs,
      reason: br.Reason ?? "employee_blocked_range",
    });
  }

  if (DEV) {
    console.log("[booking-control override]", {
      empId,
      date: dateStr,
      baseSchedule,
      overrides: active,
      effectiveSchedule: {
        isWorking: effective.isWorking,
        start: effective.start,
        end: effective.end,
      },
      blockedIntervals: effective.blockedIntervals,
    });
  }

  return effective;
}

// ── Slot-level check ──────────────────────────────────────────────────────────

/**
 * Check if a slot [slotMs, slotMs+durMs) is blocked by any override interval.
 * Returns the reason string if blocked, null if clear.
 */
export function slotBlockedByOverride(
  slotMs: number,
  slotEndMs: number,
  effectiveSchedule: EffectiveSchedule,
): string | null {
  for (const iv of effectiveSchedule.blockedIntervals) {
    if (slotMs < iv.endMs && slotEndMs > iv.startMs) {
      return iv.reason;
    }
  }
  return null;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function nextDate(dateStr: string): string {
  // Anchor at noon UTC so server-local TZ never flips the calendar date.
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
