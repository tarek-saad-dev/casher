import { AvailabilityBitmap } from '@/lib/booking/domain/AvailabilityBitmap';
import type { V2PublicAvailabilityDayDto } from '@/lib/booking/v2Frontend/publicSafeDtos';
import type { GeneratedStart, MatrixCacheEntry, MatrixScope } from '@/lib/operations/bookingV2/types';

export const TRACE_SLOT = {
  employeeId: 5,
  branchCode: 'GLEEM',
  businessDate: '2026-08-18',
  startMin: 16 * 60,
  durationMinutes: 30,
  time: '16:00',
} as const;

type TraceSlotConfig = typeof TRACE_SLOT;

function getTraceSlot(): TraceSlotConfig {
  if (typeof window !== 'undefined') {
    const override = (window as unknown as { __traceSlotConfig?: Partial<TraceSlotConfig> }).__traceSlotConfig;
    if (override?.employeeId && override?.branchCode && override?.businessDate && override?.time && override?.durationMinutes && typeof override.startMin === 'number') {
      return {
        employeeId: override.employeeId,
        branchCode: override.branchCode,
        businessDate: override.businessDate,
        time: override.time,
        durationMinutes: override.durationMinutes,
        startMin: override.startMin,
      };
    }
  }
  return TRACE_SLOT;
}

export function traceLog(stage: string, payload: Record<string, unknown>): void {
  const entry = { stage, payload, at: Date.now() };
  console.log(stage, payload);
  if (typeof window !== 'undefined') {
    const w = window as unknown as { __traceSlotLogs?: unknown[] };
    if (!Array.isArray(w.__traceSlotLogs)) w.__traceSlotLogs = [];
    w.__traceSlotLogs.push(entry);
  }
}

export function isTraceDay(day: Pick<V2PublicAvailabilityDayDto, 'employeeId' | 'branchCode' | 'businessDate'>): boolean {
  const trace = getTraceSlot();
  return day.employeeId === trace.employeeId
    && day.branchCode.toUpperCase() === trace.branchCode
    && day.businessDate === trace.businessDate;
}

export function traceMaskAllows(day: Pick<V2PublicAvailabilityDayDto, 'employeeId' | 'branchCode' | 'businessDate' | 'freeMaskB64'> | null | undefined): boolean | null {
  if (!day || !isTraceDay(day)) return null;
  const trace = getTraceSlot();
  return AvailabilityBitmap.fromBase64(day.freeMaskB64).hasConsecutiveFreeAt(
    trace.startMin,
    trace.durationMinutes,
  );
}

export function traceStartsInclude(starts: Array<Pick<GeneratedStart, 'employeeId' | 'branchCode' | 'businessDate' | 'time' | 'durationMinutes'>>): boolean {
  const trace = getTraceSlot();
  return starts.some((s) =>
    s.employeeId === trace.employeeId
    && s.branchCode.toUpperCase() === trace.branchCode
    && s.businessDate === trace.businessDate
    && s.time === trace.time
    && s.durationMinutes === trace.durationMinutes,
  );
}

export function traceDayFromMatrixEntry(entry: MatrixCacheEntry | null | undefined): V2PublicAvailabilityDayDto | null {
  if (!entry) return null;
  return entry.matrix.days.find(isTraceDay) ?? null;
}

export function traceMatchesAvailableSlot(slot: {
  empId: number;
  branchCode?: string | null;
  businessDate?: string | null;
  time: string;
  durationMinutes: number;
}): boolean {
  const trace = getTraceSlot();
  return slot.empId === trace.employeeId
    && (slot.branchCode ?? '').toUpperCase() === trace.branchCode
    && (slot.businessDate ?? '') === trace.businessDate
    && slot.time === trace.time
    && slot.durationMinutes === trace.durationMinutes;
}

export function traceSummaryForDay(day: Pick<V2PublicAvailabilityDayDto, 'employeeId' | 'branchCode' | 'businessDate' | 'freeMaskB64' | 'availabilityRevision'> | null | undefined) {
  if (!day) return null;
  const trace = getTraceSlot();
  return {
    traceTime: trace.time,
    employeeId: day.employeeId,
    branchCode: day.branchCode,
    businessDate: day.businessDate,
    availabilityRevision: day.availabilityRevision,
    freeMaskB64: day.freeMaskB64,
    fits16_00x30: traceMaskAllows(day),
  };
}

export function traceScopeLabel(scope: MatrixScope): string {
  if (scope.kind === 'employee') {
    return `employee:${scope.employeeId}:${scope.branchCodes.join(',')}:${scope.fromBusinessDate}:${scope.toBusinessDate}`;
  }
  return `roster:${scope.branchCode}:${scope.fromBusinessDate}:${scope.toBusinessDate}`;
}
