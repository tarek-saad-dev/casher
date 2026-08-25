/**
 * Single resolver for branch timezone, business cutoff, business date, "now",
 * and the automatic BusinessDay rollover window.
 */
import {
  BUSINESS_DAY_CUTOFF_HOUR,
  SALON_TZ,
  getOperationalDate,
} from '@/lib/businessDate';

export type BusinessClockBranch = {
  timeZone: string;
  businessDayCutoffTime: string;
};

export type ResolvedBusinessClock = {
  timeZone: string;
  cutoffTime: string;
  cutoffHour: number;
  now: Date;
  businessDate: string;
};

const DEFAULT_TZ = SALON_TZ;
const DEFAULT_CUTOFF = '04:00:00';
/** Automatic reconciliation window in branch-local time. Not the overnight cutoff. */
export const DEFAULT_ROLLOVER_LOCAL_TIME = '08:00';
const DEFAULT_ROLLOVER_MINUTES = 8 * 60;

/** Parse "HH:mm:ss" (or "HH") into a 0–23 hour. Invalid values fall back to 04:00. */
export function parseBusinessCutoffHour(cutoff: string | null | undefined): number {
  const hour = Number(String(cutoff ?? DEFAULT_CUTOFF).slice(0, 2));
  return Number.isFinite(hour) ? hour : BUSINESS_DAY_CUTOFF_HOUR;
}

export function resolveTimeZone(timeZone: string | null | undefined): string {
  return timeZone || DEFAULT_TZ;
}

export function resolveCutoffTime(cutoff: string | null | undefined): string {
  return cutoff || DEFAULT_CUTOFF;
}

/** Authoritative "current timestamp" for operational domain code. */
export function now(at?: Date): Date {
  return at ?? new Date();
}

/** Cutoff-aware business date for a branch (overnight stays on the previous calendar day). */
export function resolveBusinessDate(branch: BusinessClockBranch, at?: Date): string {
  return getOperationalDate({
    now: now(at),
    timeZone: resolveTimeZone(branch.timeZone),
    cutoffHour: parseBusinessCutoffHour(branch.businessDayCutoffTime),
  });
}

export function resolveBusinessClock(
  branch: BusinessClockBranch,
  at?: Date,
): ResolvedBusinessClock {
  const current = now(at);
  const timeZone = resolveTimeZone(branch.timeZone);
  const cutoffTime = resolveCutoffTime(branch.businessDayCutoffTime);
  const cutoffHour = parseBusinessCutoffHour(cutoffTime);
  return {
    timeZone,
    cutoffTime,
    cutoffHour,
    now: current,
    businessDate: getOperationalDate({
      now: current,
      timeZone,
      cutoffHour,
    }),
  };
}

export type BranchLocalClockParts = {
  date: string;
  hour: number;
  minute: number;
  minutesSinceMidnight: number;
};

/** Local wall-clock parts in the branch timezone (BusinessClock `now`, never GETDATE()). */
export function getBranchLocalClockParts(
  timeZone: string | null | undefined,
  at?: Date,
): BranchLocalClockParts {
  const current = now(at);
  const tz = resolveTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(current);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '0';
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour,
    minute,
    minutesSinceMidnight: hour * 60 + minute,
  };
}

function parseLocalHm(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

/**
 * Rollover local time in minutes since midnight.
 * Lightweight config: BUSINESS_DAY_ROLLOVER_LOCAL_TIME=HH:mm, else 08:00.
 * Does not use TblBranch.DefaultOpenTime (salon hours, not day reconciliation).
 */
export function resolveRolloverMinutesSinceMidnight(
  env: { BUSINESS_DAY_ROLLOVER_LOCAL_TIME?: string } = process.env,
): number {
  return parseLocalHm(env.BUSINESS_DAY_ROLLOVER_LOCAL_TIME) ?? DEFAULT_ROLLOVER_MINUTES;
}

export function resolveRolloverLocalTime(
  env: { BUSINESS_DAY_ROLLOVER_LOCAL_TIME?: string } = process.env,
): string {
  const minutes = resolveRolloverMinutesSinceMidnight(env);
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** True at/after the branch-local rollover window (default 08:00). */
export function isPastRolloverWindow(
  branch: Pick<BusinessClockBranch, 'timeZone'>,
  at?: Date,
  env: { BUSINESS_DAY_ROLLOVER_LOCAL_TIME?: string } = process.env,
): boolean {
  const local = getBranchLocalClockParts(branch.timeZone, at);
  return local.minutesSinceMidnight >= resolveRolloverMinutesSinceMidnight(env);
}

export const BusinessClock = {
  now,
  parseBusinessCutoffHour,
  resolveTimeZone,
  resolveCutoffTime,
  resolveBusinessDate,
  resolveBusinessClock,
  getBranchLocalClockParts,
  resolveRolloverLocalTime,
  resolveRolloverMinutesSinceMidnight,
  isPastRolloverWindow,
  DEFAULT_ROLLOVER_LOCAL_TIME,
};
