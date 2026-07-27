/**
 * Booking Phase 3 — pure public barber eligibility / contract helpers.
 * No DB / server-only — safe for unit tests.
 */
import { isEmployeeHiddenFromPublicBooking } from '@/lib/hr/testEmployeePolicy';
import { sanitizePublicImageUrl } from '@/lib/booking/publicBookingServicePolicy';

export const PUBLIC_BOOKING_BARBER_CONTRACT_VERSION = 'v3';
export const MAX_PUBLIC_BARBER_CALENDAR_DAYS = 31;

export type PublicBarberAvailabilityType = 'presence_only';

export type PublicBarberCalendarStatus =
  | 'presence_only'
  | 'available'
  | 'fully_booked'
  | 'day_off'
  | 'global_leave'
  | 'branch_closed'
  | 'not_assigned'
  | 'not_available_publicly'
  | 'service_not_available'
  | 'outside_booking_horizon';

export type PublicBarberEmployeeInput = {
  empId: number;
  name: string | null;
  isActive?: boolean | number | null;
  job?: string | null;
  imageUrl?: string | null;
  shortBio?: string | null;
  displaySortOrder?: number | null;
  isFeatured?: boolean | number | null;
};

export type PublicBarberAssignmentInput = {
  branchId: number;
  branchCode: string;
  branchName: string;
  isActive: boolean;
  canReceiveBookings: boolean;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
};

export type PublicBarberEligibilityInput = {
  employee: PublicBarberEmployeeInput;
  branchAssignment?: PublicBarberAssignmentInput | null;
  /** True when branch passes public booking visibility (all-four). */
  branchIsPubliclyBookable?: boolean;
  /** Count of legitimate Phase-2 public services (global catalog). */
  publicServiceCount: number;
  /** When WorkDate supplied: scheduled/working at the target public branch. */
  isWorkingAtBranchOnDate?: boolean | null;
  /** Global leave on the WorkDate. */
  isGlobalLeave?: boolean | null;
  /** Requested services all valid in public catalog (when serviceIds provided). */
  requestedServicesOk?: boolean | null;
};

export type PublicBarberEligibilityReason =
  | 'ok'
  | 'inactive'
  | 'test_or_smoke'
  | 'missing_assignment'
  | 'cannot_receive_bookings'
  | 'branch_not_public'
  | 'no_public_services'
  | 'not_working_on_date'
  | 'global_leave'
  | 'service_mismatch';

export function isBarberJob(job: string | null | undefined): boolean {
  const j = String(job ?? '').trim();
  return j === 'حلاق' || j === 'مساعد' || j.toLowerCase() === 'barber';
}

export function isEmployeeActive(isActive: boolean | number | null | undefined): boolean {
  if (isActive === false || isActive === 0) return false;
  return true; // null/undefined treated active (legacy ISNULL)
}

export function evaluateEmployeePublicBookingEligibility(
  input: PublicBarberEligibilityInput,
): { eligible: boolean; reason: PublicBarberEligibilityReason } {
  const { employee } = input;
  if (!isEmployeeActive(employee.isActive)) {
    return { eligible: false, reason: 'inactive' };
  }
  if (isEmployeeHiddenFromPublicBooking(employee.name)) {
    return { eligible: false, reason: 'test_or_smoke' };
  }
  if (input.publicServiceCount <= 0) {
    return { eligible: false, reason: 'no_public_services' };
  }
  if (input.isGlobalLeave === true) {
    return { eligible: false, reason: 'global_leave' };
  }
  if (input.requestedServicesOk === false) {
    return { eligible: false, reason: 'service_mismatch' };
  }

  const assignment = input.branchAssignment;
  if (assignment) {
    if (!assignment.isActive) {
      return { eligible: false, reason: 'missing_assignment' };
    }
    if (!assignment.canReceiveBookings) {
      return { eligible: false, reason: 'cannot_receive_bookings' };
    }
    if (input.branchIsPubliclyBookable === false) {
      return { eligible: false, reason: 'branch_not_public' };
    }
  }

  if (input.isWorkingAtBranchOnDate === false) {
    return { eligible: false, reason: 'not_working_on_date' };
  }

  return { eligible: true, reason: 'ok' };
}

export function isEmployeeEligibleForPublicBooking(
  input: PublicBarberEligibilityInput,
): boolean {
  return evaluateEmployeePublicBookingEligibility(input).eligible;
}

export function sanitizePublicBarberImageUrl(raw: string | null | undefined): string | null {
  return sanitizePublicImageUrl(raw);
}

export function sanitizePublicShortBio(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const plain = String(raw)
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return null;
  return plain.slice(0, 280);
}

export function comparePublicBarbers(
  a: {
    displaySortOrder: number;
    isFeatured: boolean;
    nameAr: string;
    empId: number;
  },
  b: {
    displaySortOrder: number;
    isFeatured: boolean;
    nameAr: string;
    empId: number;
  },
): number {
  if (a.isFeatured !== b.isFeatured) return a.isFeatured ? -1 : 1;
  if (a.displaySortOrder !== b.displaySortOrder) {
    return a.displaySortOrder - b.displaySortOrder;
  }
  const nameCmp = a.nameAr.localeCompare(b.nameAr, 'ar', { sensitivity: 'base' });
  if (nameCmp !== 0) return nameCmp;
  return a.empId - b.empId;
}

export function parsePublicServiceIdsParam(
  raw: string | null | undefined,
): { ok: true; ids: number[] } | { ok: false; invalid: true } {
  if (raw == null || String(raw).trim() === '') {
    return { ok: true, ids: [] };
  }
  const parts = String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n <= 0) return { ok: false, invalid: true };
    if (seen.has(n)) continue;
    seen.add(n);
    ids.push(n);
  }
  return { ok: true, ids };
}

/** Inclusive day count between YYYY-MM-DD dates. */
export function inclusiveDaySpan(from: string, to: string): number {
  const a = Date.parse(`${from}T12:00:00Z`);
  const b = Date.parse(`${to}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return -1;
  return Math.floor((b - a) / 86_400_000) + 1;
}

export function eachDateInclusive(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (d.getTime() <= end.getTime()) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/**
 * Days beyond booking horizon → outside_booking_horizon.
 * `horizonEnd` is inclusive YYYY-MM-DD (today + maxBookingDaysAhead).
 */
export function isOutsideBookingHorizon(date: string, horizonEnd: string): boolean {
  return date > horizonEnd;
}

export function dedupeBarbersByEmpId<T extends { empId: number }>(rows: T[]): T[] {
  const map = new Map<number, T>();
  for (const row of rows) {
    if (!map.has(row.empId)) map.set(row.empId, row);
  }
  return [...map.values()];
}
