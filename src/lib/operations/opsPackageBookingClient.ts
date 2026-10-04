/**
 * Ops booking workspace — package booking calls into the canonical public booking
 * plan → check-slot → create contract (`source: 'operations'`, `packageId`).
 * Price / duration / services are always resolved server-side.
 */
import type {
  OpsBookablePackage,
  OpsBookablePackagesResponse,
} from '@/lib/operations/opsBookablePackagesTypes';

export type OpsPackageSelection = {
  packageId: number;
  date: string;
  time: string;
  dayOffset: 0 | 1;
  mode: 'nearest' | 'specific';
  empId: number;
  branchId?: number | null;
};

export type OpsPackageStepResult =
  | { ok: true; planToken?: string | null }
  | { ok: false; message: string; slotConflict: boolean };

/** Codes that mean the package itself cannot be booked here (not the chosen slot). */
const PACKAGE_LEVEL_CODES = new Set([
  'PACKAGE_NOT_FOUND',
  'PACKAGE_NOT_ACTIVE',
  'PACKAGE_EMPTY',
  'PACKAGE_SERVICE_INVALID',
  'PACKAGE_DURATION_MISSING',
  'INVALID_PACKAGE_ID',
  'SERVICE_NOT_AVAILABLE_AT_BRANCH',
  'SERVICES_NOT_CONFIGURED',
]);

export function buildOpsPackageSelectionBody(sel: OpsPackageSelection): Record<string, unknown> {
  return {
    packageId: sel.packageId,
    date: sel.date,
    time: sel.time,
    dayOffset: sel.dayOffset,
    mode: sel.mode,
    empId: sel.empId,
    source: 'operations',
    ...(sel.branchId != null ? { branchId: sel.branchId } : {}),
  };
}

export function parseOpsPackageStepError(
  data: unknown,
  fallback: string,
): { message: string; slotConflict: boolean } {
  const err =
    data && typeof data === 'object'
      ? ((data as { error?: unknown }).error as
          | { code?: unknown; message?: unknown; metadata?: { messageHint?: unknown; availabilityCode?: unknown } }
          | string
          | undefined)
      : undefined;
  if (!err || typeof err !== 'object') {
    return { message: typeof err === 'string' && err.trim() ? err : fallback, slotConflict: false };
  }
  const code = typeof err.code === 'string' ? err.code : '';
  const hint = typeof err.metadata?.messageHint === 'string' ? err.metadata.messageHint : '';
  const message = hint || (typeof err.message === 'string' && err.message) || fallback;
  return { message, slotConflict: !!code && !PACKAGE_LEVEL_CODES.has(code) };
}

export async function fetchOpsBookablePackages(
  branchCode: string | null,
  signal?: AbortSignal,
): Promise<OpsBookablePackage[]> {
  const qs = branchCode ? `?branchCode=${encodeURIComponent(branchCode)}` : '';
  const res = await fetch(`/api/operations/booking-packages${qs}`, { signal });
  const data = (await res.json().catch(() => ({}))) as
    | OpsBookablePackagesResponse
    | { ok: false; error?: string };
  if (!res.ok || !data.ok) {
    throw new Error(('error' in data && data.error) || 'تعذر تحميل الباكدجات');
  }
  return data.packages;
}

export async function checkOpsPackageSlot(sel: OpsPackageSelection): Promise<OpsPackageStepResult> {
  const res = await fetch('/api/public/booking/check-slot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildOpsPackageSelectionBody(sel)),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) {
    return { ok: false, ...parseOpsPackageStepError(data, 'تعذر التحقق من الموعد') };
  }
  if (data.available === false) {
    const code = typeof data.reason?.code === 'string' ? data.reason.code : '';
    return {
      ok: false,
      message: data.reason?.message || 'الموعد لم يعد متاحًا',
      slotConflict: !PACKAGE_LEVEL_CODES.has(code),
    };
  }
  return { ok: true };
}

export async function planOpsPackageBooking(sel: OpsPackageSelection): Promise<OpsPackageStepResult> {
  const res = await fetch('/api/public/booking/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildOpsPackageSelectionBody(sel)),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) {
    return { ok: false, ...parseOpsPackageStepError(data, 'تعذر تجهيز حجز الباكدج') };
  }
  return { ok: true, planToken: data.plan?.planToken ?? null };
}
