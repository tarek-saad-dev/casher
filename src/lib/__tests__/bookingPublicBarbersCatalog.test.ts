/**
 * Booking Phase 3 — public barber policy + uniqueness/assembly tests.
 */
import { describe, expect, it } from 'vitest';
import {
  comparePublicBarbers,
  dedupeBarbersByEmpId,
  evaluateEmployeePublicBookingEligibility,
  inclusiveDaySpan,
  isOutsideBookingHorizon,
  MAX_PUBLIC_BARBER_CALENDAR_DAYS,
  parsePublicServiceIdsParam,
} from '@/lib/booking/publicBookingBarberPolicy';
import { isTestOrSmokeEmployeeName } from '@/lib/hr/testEmployeePolicy';
import { assemblePublicBarbersFromCandidates } from '@/lib/booking/publicBookingBarbers';
import { vi } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/db', () => ({
  getPool: async () => ({ request: () => ({ input() { return this; }, query: async () => ({ recordset: [] }) }) }),
  sql: { Int: 0, Date: 0, NVarChar: () => 0, Bit: 0 },
}));

vi.mock('@/lib/booking/publicBookingBranchContext', () => ({
  resolvePublicBookingBranchContext: async () => ({
    branchId: 1,
    branchCode: 'GLEEM',
    branchName: 'جليم',
    publicBookingEnabled: true,
    bookingEnabled: true,
  }),
  PublicBookingBranchContextError: class extends Error {},
}));

vi.mock('@/lib/booking/publicBookingServices', () => ({
  getPublicBookingServicesCatalog: async () => ({ services: [{ serviceId: 9 }] }),
  invalidatePublicBookingServicesCache: () => undefined,
}));

vi.mock('@/lib/hr/employeeBranchScheduleResolver', () => ({
  resolveEmployeeGlobalSchedule: async () => ({
    branches: [],
    isGloballyWorking: false,
    isGlobalDayOff: false,
  }),
}));

vi.mock('@/lib/branch/publicBranchVisibility', () => ({
  canBranchAppearInPublicBooking: async () => true,
}));

vi.mock('@/lib/branch/repository', () => ({
  getBranchById: async () => null,
}));

vi.mock('@/lib/publicBookingHelpers', () => ({
  getPublicSettings: async () => ({ maxBookingDaysAhead: 14 }),
  isValidDate: (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s),
}));

vi.mock('@/lib/businessDate', () => ({
  getCairoBusinessDate: () => '2026-08-01',
}));

describe('bookingPublicBarbersCatalog / policy', () => {
  it('excludes inactive, test, no services, cannot book', () => {
    expect(
      evaluateEmployeePublicBookingEligibility({
        employee: { empId: 1, name: 'زياد', isActive: false },
        publicServiceCount: 30,
      }).reason,
    ).toBe('inactive');
    expect(
      evaluateEmployeePublicBookingEligibility({
        employee: { empId: 1, name: '[TEST] X', isActive: true },
        publicServiceCount: 30,
      }).reason,
    ).toBe('test_or_smoke');
    expect(isTestOrSmokeEmployeeName('[SMOKE CC]')).toBe(true);
    expect(
      evaluateEmployeePublicBookingEligibility({
        employee: { empId: 1, name: 'زياد', isActive: true },
        publicServiceCount: 0,
      }).reason,
    ).toBe('no_public_services');
    expect(
      evaluateEmployeePublicBookingEligibility({
        employee: { empId: 1, name: 'زياد', isActive: true },
        branchAssignment: {
          branchId: 1,
          branchCode: 'GLEEM',
          branchName: 'جليم',
          isActive: true,
          canReceiveBookings: false,
        },
        branchIsPubliclyBookable: true,
        publicServiceCount: 30,
      }).reason,
    ).toBe('cannot_receive_bookings');
  });

  it('one row per EmpID across two branches; same name different EmpIDs stay two', () => {
    const assembled = assemblePublicBarbersFromCandidates(
      [
        { empId: 12, name: 'زياد', branchCode: 'GLEEM', branchName: 'جليم' },
        { empId: 12, name: 'زياد', branchCode: 'OTHER', branchName: 'آخر' },
        { empId: 99, name: 'زياد', branchCode: 'GLEEM', branchName: 'جليم' },
      ],
      [9, 10],
    );
    expect(assembled).toHaveLength(2);
    const ziad = assembled.find((b) => b.empId === 12)!;
    expect(ziad.branches).toHaveLength(2);
    expect(dedupeBarbersByEmpId(assembled).map((b) => b.empId).sort()).toEqual([12, 99]);
  });

  it('deterministic ordering by Arabic name then EmpID', () => {
    expect(
      comparePublicBarbers(
        { displaySortOrder: 999, isFeatured: false, nameAr: 'احمد', empId: 18 },
        { displaySortOrder: 999, isFeatured: false, nameAr: 'زياد', empId: 12 },
      ),
    ).toBeLessThan(0);
  });

  it('date range and serviceIds parsing', () => {
    expect(inclusiveDaySpan('2026-08-01', '2026-08-07')).toBe(7);
    expect(inclusiveDaySpan('2026-08-01', '2026-08-01')).toBe(1);
    expect(MAX_PUBLIC_BARBER_CALENDAR_DAYS).toBe(31);
    expect(isOutsideBookingHorizon('2026-09-01', '2026-08-15')).toBe(true);
    expect(parsePublicServiceIdsParam('9,10').ok && parsePublicServiceIdsParam('9,10').ids).toEqual([
      9, 10,
    ]);
    expect(parsePublicServiceIdsParam('abc').ok).toBe(false);
  });

  it('wire has no private fields', () => {
    const [b] = assemblePublicBarbersFromCandidates(
      [{ empId: 12, name: 'زياد', branchCode: 'GLEEM', branchName: 'جليم' }],
      [9],
    );
    const json = JSON.stringify(b);
    expect(json).not.toMatch(/salary|payroll|target|phone|NationalID|ledger/i);
    expect(b.availabilityType).toBe('presence_only');
    expect(b.imageUrl).toBeNull();
  });
});
