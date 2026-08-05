/**
 * Phase 3A — Daily adjustment contracts and validation.
 */

import { salonDateTimeToMs } from '@/lib/publicBookingHelpers';
import { SALON_TZ } from '@/lib/businessDate';

export const DAILY_ADJUSTMENT_TYPES = [
  'CLOSE_DAY',
  'REPLACE_WINDOWS',
  'ADD_WINDOW',
  'BLOCK_WINDOW',
] as const;

export type DailyAdjustmentType = (typeof DAILY_ADJUSTMENT_TYPES)[number];

export const DAILY_ADJUSTMENT_SOURCES = [
  'admin',
  'operations',
  'attendance',
  'migration',
  'system',
] as const;

export type DailyAdjustmentSource = (typeof DAILY_ADJUSTMENT_SOURCES)[number];

export type DailyAdjustmentWindowInput = {
  start: string;
  end: string;
  endDayOffset?: 0 | 1;
};

export type DailyAdjustmentWindow = {
  start: string;
  end: string;
  endDayOffset: 0 | 1;
  startMs: number;
  endMs: number;
};

export type EmployeeDailyAdjustment = {
  adjustmentId: number;
  branchId: number;
  employeeId: number;
  businessDate: string;
  adjustmentType: DailyAdjustmentType;
  reasonCode: string | null;
  reasonText: string | null;
  source: DailyAdjustmentSource;
  windows: DailyAdjustmentWindow[];
  createdBy: number | null;
  createdAt: string;
  version: number;
};

export type DailyAdjustmentState =
  | 'NONE'
  | 'CLOSED'
  | 'REPLACED'
  | 'EXTENDED'
  | 'BLOCKED'
  | 'MIXED';

export type CreateDailyAdjustmentInput = {
  branchId: number;
  empId: number;
  businessDate: string;
  adjustmentType: DailyAdjustmentType;
  reasonCode?: string | null;
  reasonText?: string | null;
  source?: DailyAdjustmentSource;
  windows?: DailyAdjustmentWindowInput[];
  createdBy: number | null;
};

export type CancelDailyAdjustmentInput = {
  branchId: number;
  adjustmentId: number;
  cancelledBy: number | null;
};

export type ListDailyAdjustmentsInput = {
  branchId: number;
  businessDate: string;
  empId?: number | null;
  /** Phase 3B.1 — active (default) | cancelled | all. Resolver still uses active only. */
  status?: 'active' | 'cancelled' | 'all';
};

export type EmployeeDailyAdjustmentHistoryItem = {
  adjustmentId: number;
  branchId: number;
  employeeId: number;
  businessDate: string;
  adjustmentType: DailyAdjustmentType;
  reasonCode: string | null;
  reasonText: string | null;
  source: DailyAdjustmentSource;
  windows: DailyAdjustmentWindow[];
  createdBy: number | null;
  createdByName?: string | null;
  createdAt: string;
  version: number;
  isActive: boolean;
  cancelledBy: number | null;
  cancelledByName?: string | null;
  cancelledAt: string | null;
};

export type DailyAdjustmentErrorCode =
  | 'INVALID_ADJUSTMENT_TYPE'
  | 'WINDOWS_REQUIRED'
  | 'WINDOWS_NOT_ALLOWED'
  | 'INVALID_WINDOW'
  | 'EMPLOYEE_NOT_ASSIGNED'
  | 'ADJUSTMENT_NOT_FOUND'
  | 'ADJUSTMENT_ALREADY_CANCELLED'
  | 'DAILY_ADJUSTMENT_CONFLICT'
  | 'INVALID_DATE'
  | 'INVALID_EMP';

const HHMM_RE = /^\d{2}:\d{2}$/;

export function isDailyAdjustmentType(v: unknown): v is DailyAdjustmentType {
  return typeof v === 'string' && (DAILY_ADJUSTMENT_TYPES as readonly string[]).includes(v);
}

export function isValidBusinessDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));
}

export function isValidHhmm(v: unknown): v is string {
  if (typeof v !== 'string' || !HHMM_RE.test(v)) return false;
  const [h, m] = v.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

function nextDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function materializeAdjustmentWindow(
  businessDate: string,
  input: DailyAdjustmentWindowInput,
  timezone = SALON_TZ,
): DailyAdjustmentWindow | null {
  if (!isValidHhmm(input.start) || !isValidHhmm(input.end)) return null;
  let endDayOffset: 0 | 1 =
    input.endDayOffset === 1 || input.endDayOffset === 0
      ? input.endDayOffset
      : 0;
  // Same calendar times with end <= start imply overnight when offset omitted.
  if (input.endDayOffset == null) {
    const [sh, sm] = input.start.split(':').map(Number);
    const [eh, em] = input.end.split(':').map(Number);
    if (eh * 60 + em <= sh * 60 + sm) endDayOffset = 1;
  }
  const startMs = salonDateTimeToMs(businessDate, input.start, timezone);
  const endMs = salonDateTimeToMs(
    endDayOffset === 1 ? nextDate(businessDate) : businessDate,
    input.end,
    timezone,
  );
  if (!(endMs > startMs)) return null;
  return {
    start: input.start,
    end: input.end,
    endDayOffset,
    startMs,
    endMs,
  };
}

export function validateCreateDailyAdjustmentInput(
  input: CreateDailyAdjustmentInput,
): { ok: true } | { ok: false; code: DailyAdjustmentErrorCode; message: string } {
  if (!Number.isInteger(input.empId) || input.empId <= 0) {
    return { ok: false, code: 'INVALID_EMP', message: 'معرف الموظف غير صالح' };
  }
  if (!isValidBusinessDate(input.businessDate)) {
    return { ok: false, code: 'INVALID_DATE', message: 'تاريخ العمل غير صالح' };
  }
  if (!isDailyAdjustmentType(input.adjustmentType)) {
    return { ok: false, code: 'INVALID_ADJUSTMENT_TYPE', message: 'نوع التعديل غير صالح' };
  }

  const windows = input.windows ?? [];
  if (input.adjustmentType === 'CLOSE_DAY') {
    if (windows.length > 0) {
      return {
        ok: false,
        code: 'WINDOWS_NOT_ALLOWED',
        message: 'إغلاق اليوم لا يقبل نوافذ زمنية',
      };
    }
    return { ok: true };
  }

  if (windows.length === 0) {
    return {
      ok: false,
      code: 'WINDOWS_REQUIRED',
      message: 'هذا النوع يتطلب نافذة زمنية واحدة على الأقل',
    };
  }

  for (const w of windows) {
    if (w.endDayOffset != null && w.endDayOffset !== 0 && w.endDayOffset !== 1) {
      return { ok: false, code: 'INVALID_WINDOW', message: 'قيمة endDayOffset يجب أن تكون 0 أو 1' };
    }
    const mat = materializeAdjustmentWindow(input.businessDate, w);
    if (!mat) {
      return {
        ok: false,
        code: 'INVALID_WINDOW',
        message: 'نافذة زمنية غير صالحة أو مدتها صفر',
      };
    }
  }

  return { ok: true };
}

export function inferDailyAdjustmentState(
  adjustments: EmployeeDailyAdjustment[],
): DailyAdjustmentState {
  if (!adjustments.length) return 'NONE';
  const types = new Set(adjustments.map((a) => a.adjustmentType));
  if (types.size > 1) return 'MIXED';
  const only = adjustments[0].adjustmentType;
  if (only === 'CLOSE_DAY') return 'CLOSED';
  if (only === 'REPLACE_WINDOWS') return 'REPLACED';
  if (only === 'ADD_WINDOW') return 'EXTENDED';
  if (only === 'BLOCK_WINDOW') return 'BLOCKED';
  return 'MIXED';
}
