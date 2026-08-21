/**
 * Hawai /operations — Booking V2 Phase O1 data-layer types.
 * Reads only; writes stay on legacy create/hold/reschedule/cancel.
 */

import type {
  V2PublicAvailabilityDayDto,
  V2PublicAvailabilityMatrixResponse,
  V2PublicBootstrapResponse,
} from '@/lib/booking/v2Frontend/publicSafeDtos';
import type { V2SlotStart } from '@/lib/booking/projection/resolveBookingAvailabilityV2';

export const BOOKING_V2_OPS_DATA_LAYER = 'booking-v2-ops-o1' as const;

export const MATRIX_WINDOW_DAYS = 14;

export type BookingV2Mode = 'specific' | 'nearest';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export type MatrixScope =
  | {
      kind: 'employee';
      employeeId: number;
      branchCodes: string[];
      fromBusinessDate: string;
      toBusinessDate: string;
    }
  | {
      kind: 'branch_roster';
      branchCode: string;
      fromBusinessDate: string;
      toBusinessDate: string;
    };

export type MatrixCacheEntry = {
  key: string;
  scope: MatrixScope;
  matrix: V2PublicAvailabilityMatrixResponse;
  fetchedAt: number;
  /** Per Emp×Branch×Date → availabilityRevision */
  revisions: Record<string, string>;
};

export type GeneratedStart = V2SlotStart & {
  employeeId: number;
  branchId: number;
  branchCode: string;
  businessDate: string;
  durationMinutes: number;
  barberName: string;
  endTime: string;
  label: string;
  startAt: string;
  endAt: string;
};

export type BookingV2StoreSnapshot = {
  bootstrap: V2PublicBootstrapResponse | null;
  bootstrapEtag: string | null;
  bootstrapStatus: LoadStatus;
  bootstrapError: string | null;
  bootstrapFetchedAt: number | null;
  /** True while a background SWR revalidate is in flight. */
  bootstrapRevalidating: boolean;

  selectedEmployeeId: number | null;
  selectedBranchCode: string | null;
  selectedServiceIds: number[];
  selectedBusinessDate: string | null;
  mode: BookingV2Mode;

  matricesByKey: Record<string, MatrixCacheEntry>;
  activeMatrixKey: string | null;
  availabilityStatus: LoadStatus;
  availabilityError: string | null;
  availabilityLoadingKey: string | null;
  /** Soft revalidate — keep showing cached matrix/starts. */
  availabilityRevalidating: boolean;

  generatedStarts: GeneratedStart[];
  /** Flat map of latest known revisions across cached matrices. */
  availabilityRevisions: Record<string, string>;
};

export type DayCell = V2PublicAvailabilityDayDto;

export function revisionKey(
  employeeId: number,
  branchCode: string,
  businessDate: string,
): string {
  return `${employeeId}|${branchCode}|${businessDate}`;
}

export function matrixScopeKey(scope: MatrixScope): string {
  if (scope.kind === 'employee') {
    const branches = [...scope.branchCodes].map((c) => c.toUpperCase()).sort().join(',');
    return `emp:${scope.employeeId}|b:${branches}|${scope.fromBusinessDate}:${scope.toBusinessDate}`;
  }
  return `roster:${scope.branchCode.toUpperCase()}|${scope.fromBusinessDate}:${scope.toBusinessDate}`;
}
