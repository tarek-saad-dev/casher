/**
 * /operations booking workspace — package booking (services | packages chooser).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildOpsPackageSelectionBody,
  parseOpsPackageStepError,
} from '@/lib/operations/opsPackageBookingClient';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('opsPackageBookingClient', () => {
  it('sends packageId with ops source and never price / duration / serviceIds', () => {
    const body = buildOpsPackageSelectionBody({
      packageId: 7,
      date: '2026-10-04',
      time: '18:00',
      dayOffset: 0,
      mode: 'specific',
      empId: 12,
      branchId: 3,
    });
    expect(body).toEqual({
      packageId: 7,
      date: '2026-10-04',
      time: '18:00',
      dayOffset: 0,
      mode: 'specific',
      empId: 12,
      source: 'operations',
      branchId: 3,
    });
    expect(body).not.toHaveProperty('serviceIds');
    expect(body).not.toHaveProperty('price');
    expect(body).not.toHaveProperty('durationMinutes');
  });

  it('omits branchId when unknown', () => {
    const body = buildOpsPackageSelectionBody({
      packageId: 1,
      date: '2026-10-04',
      time: '01:00',
      dayOffset: 1,
      mode: 'nearest',
      empId: 5,
      branchId: null,
    });
    expect(body).not.toHaveProperty('branchId');
    expect(body.dayOffset).toBe(1);
  });

  it('package-level errors do not send the operator back to slot selection', () => {
    const res = parseOpsPackageStepError(
      { ok: false, error: { code: 'SERVICE_NOT_AVAILABLE_AT_BRANCH', message: 'الخدمة غير متاحة في هذا الفرع' } },
      'fallback',
    );
    expect(res).toEqual({ message: 'الخدمة غير متاحة في هذا الفرع', slotConflict: false });
  });

  it('slot errors prefer the evaluator hint and trigger slot recovery', () => {
    const res = parseOpsPackageStepError(
      {
        ok: false,
        error: {
          code: 'BOOKING_PLAN_UNAVAILABLE',
          message: 'generic',
          metadata: { messageHint: 'الحلاق مشغول في هذا الوقت' },
        },
      },
      'fallback',
    );
    expect(res).toEqual({ message: 'الحلاق مشغول في هذا الوقت', slotConflict: true });
  });

  it('falls back on non-catalog errors', () => {
    expect(parseOpsPackageStepError({ ok: false, error: 'غير مصرح' }, 'fallback')).toEqual({
      message: 'غير مصرح',
      slotConflict: false,
    });
    expect(parseOpsPackageStepError(null, 'fallback').message).toBe('fallback');
  });
});

describe('ops package booking wiring', () => {
  it('plan / check-slot / create share internal ops branch resolution', () => {
    for (const route of ['plan', 'check-slot', 'create']) {
      const src = read(`src/app/api/public/booking/${route}/route.ts`);
      expect(src).toContain('resolveInternalOpsBookingRequest');
      expect(src).toContain('packageId: body.packageId');
    }
    const plan = read('src/app/api/public/booking/plan/route.ts');
    expect(plan).toContain("internalAuth ? 'internal_preview' : 'plan'");
    const check = read('src/app/api/public/booking/check-slot/route.ts');
    expect(check).toContain("internalAuth ? 'internal_preview' : 'check_slot'");

    const helper = read('src/lib/booking/internalOpsBookingRequest.ts');
    expect(helper).toContain('requireBranchOperationAccess()');
    expect(helper).toContain('resolveOpsWriteBranch');
  });

  it('package list requires operations access and a branch visible to the user', () => {
    const route = read('src/app/api/operations/booking-packages/route.ts');
    expect(route).toContain('requireBranchOperationAccess()');
    expect(route).toContain('listUserOpsVisibleBranchIds');
    expect(route).toContain("code: 'NO_BRANCH_ACCESS'");
  });

  it('package list is resolved per branch by the public package resolver', () => {
    const lib = read('src/lib/operations/opsBookablePackages.ts');
    expect(lib).toContain('resolvePublicPackageBooking');
    expect(lib).toContain("purpose: 'internal_preview'");
    expect(lib).toContain('unavailableReason');
  });

  it('workspace starts on the services | packages chooser and keeps the services flow', () => {
    const ws = read('src/components/operations/booking-workspace/useBookingWorkspace.ts');
    expect(ws).toContain('setBookingKind(null)');
    expect(ws).toContain('planOpsPackageBooking');
    expect(ws).toContain('checkOpsPackageSlot');
    expect(ws).toContain('...(packageFields ?? { serviceIds })');
    const modal = read('src/components/operations/booking-workspace/BookingWorkspaceModal.tsx');
    expect(modal).toContain('<BookingKindChooser');
    expect(modal).toContain('<BookingStepPackages');
    expect(modal).toContain('<BookingStepServices');
    const chooser = read('src/components/operations/booking-workspace/BookingKindChooser.tsx');
    expect(chooser).toContain('حجز خدمات');
    expect(chooser).toContain('حجز باكدجات');
  });
});
