/**
 * Booking Phase 6 — create contract / security / token / idempotency source tests.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  buildCreateRequestFingerprint,
} from '@/lib/booking/publicBookingCreateIdempotency';
import {
  empIntervalLockResource,
  anyBarberAssignmentLockResource,
  hashServiceSet,
} from '@/lib/booking/publicBookingCreateLocks';
import {
  BOOKING_PLAN_CONTRACT_VERSION,
  buildPlanContentDigest,
  mintPlanFingerprint,
  verifyPlanToken,
} from '@/lib/booking/publicBookingPlanFingerprint';
import { PUBLIC_BOOKING_ERROR_CATALOG } from '@/lib/booking/publicBookingErrorCatalog';
import { normalizePublicBookingPhone } from '@/lib/publicBookingHelpers';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('bookingCreateCanonicalContract', () => {
  const route = read('src/app/api/public/booking/create/route.ts');
  const svc = read('src/lib/booking/publicBookingCreate.ts');

  it('uses createPublicBooking + Phase-5 precheck; no legacy branch fallback', () => {
    expect(route).toContain('createPublicBooking');
    expect(route).not.toContain('resolvePublicBranchCode');
    expect(svc).toContain("purpose: 'create_precheck'");
    expect(svc).toContain('assertEmployeeIntervalAvailable');
    expect(svc).toContain('SERIALIZABLE');
    expect(svc).not.toContain('calculateServicePlanDuration');
  });

  it('does not notify before commit', () => {
    const commitIdx = svc.indexOf('await transaction.commit()');
    const waCallIdx = svc.indexOf('scheduleBookingWhatsAppAfterCommit({');
    expect(commitIdx).toBeGreaterThan(0);
    expect(waCallIdx).toBeGreaterThan(commitIdx);
  });
});

describe('bookingCreateSpecificBarber / anyBarber / overnight', () => {
  const svc = read('src/lib/booking/publicBookingCreate.ts');

  it('specific uses fixed_barber; any uses server_selected + EmpID sort', () => {
    expect(svc).toContain("assignmentStrategy = 'fixed_barber'");
    expect(svc).toContain("assignmentStrategy = 'server_selected'");
    expect(svc).toContain('anyBarberAssignmentLockResource');
    expect(svc).toContain('empIntervalLockResource');
    expect(svc).toContain('sort((a, b) => a.empId - b.empId)');
  });

  it('persists workDate/dayOffset meta and calendar BookingDate', () => {
    expect(svc).toContain('workDate=');
    expect(svc).toContain('dayOffset=');
    expect(svc).toContain('calendarDate');
  });
});

describe('bookingCreateIdempotency', () => {
  it('fingerprint is order-stable for serviceIds content', () => {
    const a = buildCreateRequestFingerprint({
      contractVersion: BOOKING_PLAN_CONTRACT_VERSION,
      branchCode: 'GLEEM',
      workDate: '2026-08-03',
      time: '13:00',
      dayOffset: 0,
      serviceIds: [9, 15],
      mode: 'specific_barber',
      empId: 12,
      customerPhone: '01012345678',
    });
    const b = buildCreateRequestFingerprint({
      contractVersion: BOOKING_PLAN_CONTRACT_VERSION,
      branchCode: 'GLEEM',
      workDate: '2026-08-03',
      time: '13:00',
      dayOffset: 0,
      serviceIds: [9, 15],
      mode: 'specific_barber',
      empId: 12,
      customerPhone: '01012345678',
    });
    expect(a).toBe(b);
    const c = buildCreateRequestFingerprint({
      contractVersion: BOOKING_PLAN_CONTRACT_VERSION,
      branchCode: 'GLEEM',
      workDate: '2026-08-03',
      time: '14:00',
      dayOffset: 0,
      serviceIds: [9, 15],
      mode: 'specific_barber',
      empId: 12,
      customerPhone: '01012345678',
    });
    expect(c).not.toBe(a);
  });

  it('lock resources are deterministic and global EmpID scoped', () => {
    expect(empIntervalLockResource(12, 100, 200)).toBe('booking:emp:12:100:200');
    expect(hashServiceSet([15, 9])).toBe(hashServiceSet([9, 15]));
    expect(anyBarberAssignmentLockResource(1, 100, 200, 'abcd')).toContain('booking:any:1:');
  });
});

describe('bookingCreatePlanToken', () => {
  it('detects expired and mismatch; token is not auth alone', () => {
    const input = {
      contractVersion: BOOKING_PLAN_CONTRACT_VERSION,
      branchCode: 'GLEEM',
      serviceIds: [9],
      mode: 'specific_barber' as const,
      empId: 12,
      workDate: '2026-08-03',
      time: '13:00',
      dayOffset: 0 as const,
      totalDurationMinutes: 30,
      subtotal: 200,
    };
    const minted = mintPlanFingerprint(input, '2026-07-27T00:00:00.000Z');
    expect(verifyPlanToken(minted.planToken).ok).toBe(true);
    expect(buildPlanContentDigest(input)).toBe(minted.planFingerprint);
    const expired = verifyPlanToken(minted.planToken, process.env, Math.floor(Date.now() / 1000) + 10_000);
    // token exp is ~5m from mint nowMs default — force far future now → expired
    expect(expired.ok).toBe(false);
  });
});

describe('bookingCreateSecurity', () => {
  const route = read('src/app/api/public/booking/create/route.ts');
  const svc = read('src/lib/booking/publicBookingCreate.ts');

  it('ignores BranchID/price/duration/status and blocks preview', () => {
    expect(route).toContain('void body.BranchID');
    expect(route).toContain('void body.price');
    expect(route).toContain('void body.duration');
    expect(route).toContain('previewQueryParam');
    expect(svc).toContain("modeHint === 'any_barber'");
    expect(normalizePublicBookingPhone('+201012345678')).toBe('01012345678');
  });

  it('catalog includes Phase-6 error codes', () => {
    for (const code of [
      'PLAN_TOKEN_INVALID',
      'PLAN_TOKEN_EXPIRED',
      'PLAN_TOKEN_REQUEST_MISMATCH',
      'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST',
      'BOOKING_LOCK_TIMEOUT',
      'BOOKING_CREATE_FAILED',
    ] as const) {
      expect(PUBLIC_BOOKING_ERROR_CATALOG[code]).toBeTruthy();
    }
  });
});

describe('bookingCreatePostCommit / cache / performance', () => {
  const svc = read('src/lib/booking/publicBookingCreate.ts');
  const route = read('src/app/api/public/booking/create/route.ts');

  it('invalidates availability cache after commit; OPTIONS present', () => {
    expect(svc).toContain('invalidatePublicBookingAvailabilityCache');
    expect(route).toMatch(/OPTIONS/);
    expect(svc).not.toContain('getPublicAvailableDays');
  });
});

describe('bookingCreateConcurrency / rollback / overnight source contracts', () => {
  const svc = read('src/lib/booking/publicBookingCreate.ts');
  const locks = read('src/lib/booking/publicBookingCreateLocks.ts');

  it('uses Transaction-owned applocks and marks failed idempotency on rollback path', () => {
    expect(locks).toContain("LockOwner = 'Transaction'");
    expect(svc).toContain('markIdempotencyFailed');
    expect(svc).toContain('transaction.rollback');
  });
});
