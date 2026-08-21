/**
 * Booking V2 B9 — public-safe DTOs for Hawai /operations and cutsaloon.com.
 * No payroll, private notes, admin-only config, or internal salary fields.
 */

import type { AvailabilityFreeRange } from '@/lib/booking/domain/AvailabilityBitmap';

export const BOOKING_V2_FRONTEND_CONTRACT = 'booking-v2-frontend-read-v1' as const;

export type V2PublicBranchDto = {
  branchId: number;
  branchCode: string;
  branchName: string;
  shortName: string | null;
  address: string | null;
  phone: string | null;
  timeZone: string;
};

export type V2PublicServiceDto = {
  serviceId: number;
  nameAr: string;
  nameEn: string;
  name: string;
  price: number;
  durationMinutes: number;
  imageUrl: string | null;
  photoUrl: string | null;
  categoryId: string;
  categoryNameAr: string;
  categoryNameEn: string;
  sortOrder: number;
  bookable: true;
};

export type V2PublicBarberDto = {
  employeeId: number;
  nameAr: string;
  nameEn: string | null;
  name: string;
  imageUrl: string | null;
  photoUrl: string | null;
  shortBio: string | null;
  displaySortOrder: number;
  serviceIds: number[];
  branchCodes: string[];
};

export type V2PublicEmployeeBranchMappingDto = {
  employeeId: number;
  branchId: number;
  branchCode: string;
};

export type V2PublicBookingSettingsDto = {
  branchId: number;
  branchCode: string;
  minNoticeMinutes: number;
  maxBookingDaysAhead: number;
  slotIntervalMinutes: number;
  allowSpecificBarber: boolean;
  allowNearestBarber: boolean;
  defaultMode: 'specific' | 'nearest' | string;
  timezone: string;
  currency: string;
  bookingEnabled: boolean;
};

export type V2PublicMediaRefDto = {
  kind: 'service' | 'barber';
  id: number;
  imageUrl: string;
};

export type V2PublicBootstrapResponse = {
  ok: true;
  contract: typeof BOOKING_V2_FRONTEND_CONTRACT;
  capability: {
    version: typeof BOOKING_V2_FRONTEND_CONTRACT;
    supportsMatrix: true;
    supportsLocalSlotGeneration: true;
    overnightTimelineHours: 48;
    availabilityQuantumMinutes: 5;
  };
  revision: string;
  generatedAt: string;
  timezone: string;
  branches: V2PublicBranchDto[];
  employees: V2PublicBarberDto[];
  employeeBranchMappings: V2PublicEmployeeBranchMappingDto[];
  /** Services keyed by branchCode (pricing is branch-scoped). */
  servicesByBranch: Record<string, V2PublicServiceDto[]>;
  settingsByBranch: Record<string, V2PublicBookingSettingsDto>;
  media: V2PublicMediaRefDto[];
};

/** Compact Emp × Branch × BusinessDate free availability (no duration starts). */
export type V2PublicAvailabilityDayDto = {
  employeeId: number;
  branchId: number;
  branchCode: string;
  businessDate: string;
  availabilityRevision: string;
  /** Half-open free ranges on the 48h business-day timeline (minutes from midnight). */
  freeRanges: AvailabilityFreeRange[];
  /** Compact FreeMask (72 bytes → base64). Prefer freeRanges for readability. */
  freeMaskB64: string;
  timezone: string;
  /** Absolute epoch ms of BusinessDate 00:00 in timezone. */
  businessDayStartAtMs: number;
  /** Exclusive end of the 48h overnight projection window. */
  timelineEndAtMs: number;
  /** Derived compatibility only — BusinessDate remains authoritative. */
  hasOvernightFree: boolean;
  isAvailable: boolean;
};

export type V2PublicAvailabilityMatrixResponse = {
  ok: true;
  contract: typeof BOOKING_V2_FRONTEND_CONTRACT;
  generatedAt: string;
  timezone: string;
  slotIntervalMinutes: number;
  fromBusinessDate: string;
  toBusinessDate: string;
  /** Echo of convenience duration used only if client asked; not cache key. */
  durationMinutes: number | null;
  days: V2PublicAvailabilityDayDto[];
};

export type V2PublicAvailabilityMatrixRequest = {
  employeeIds?: number[];
  employeeId?: number;
  branchIds?: number[];
  branchId?: number;
  branchCodes?: string[];
  branchCode?: string;
  fromBusinessDate: string;
  toBusinessDate: string;
  /** Convenience only — resolves catalog duration; does not create service-specific cache. */
  serviceId?: number;
  serviceIds?: number[];
  /** Internal/override when allowed; public clients should prefer serviceIds. */
  durationMinutes?: number;
};
