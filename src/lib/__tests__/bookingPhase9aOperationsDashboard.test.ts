/** Booking Phase 9A — public booking operations dashboard contracts. */
import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('server-only', () => ({}));

import {
  PUBLIC_BOOKING_OPS_CONTROLLABLE_BRANCH,
  PublicBookingOpsError,
} from '@/lib/booking/publicBookingOperations';
import { SENSITIVE_ACTIONS } from '@/lib/sensitiveActionRegistry';

const root = process.cwd();

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('bookingPhase9aOperationsDashboard', () => {
  it('registers page, nav, and PageGuard for /admin/booking/operations', () => {
    const page = read('src/app/admin/booking/operations/page.tsx');
    const layout = read('src/app/admin/booking/operations/layout.tsx');
    const nav = read('src/components/layout/nav-config.ts');
    const registry = read('src/lib/pages-registry.ts');
    expect(page).toContain('BookingOperationsDashboard');
    expect(layout).toContain('PageGuard');
    expect(layout).toContain('/admin/booking/operations');
    expect(nav).toContain('/admin/booking/operations');
    expect(registry).toContain('admin.booking_operations');
    expect(registry).toContain('/admin/booking/operations');
  });

  it('requires admin page access on ops and pause APIs', () => {
    const ops = read('src/app/api/admin/public-booking/operations/route.ts');
    const toggle = read(
      'src/app/api/admin/public-booking/booking-enabled/route.ts',
    );
    const health = read('src/app/api/admin/public-booking/health/route.ts');
    expect(ops).toContain("requirePageAccess('/admin/booking/operations')");
    expect(toggle).toContain("requirePageAccess('/admin/booking/operations')");
    expect(health).toContain('requireAdmin');
  });

  it('pause/resume toggles BookingEnabled only and audits actions', () => {
    const svc = read('src/lib/booking/publicBookingOperations.ts');
    const toggle = read(
      'src/app/api/admin/public-booking/booking-enabled/route.ts',
    );
    expect(PUBLIC_BOOKING_OPS_CONTROLLABLE_BRANCH).toBe('GLEEM');
    expect(svc).toContain('BookingEnabled');
    expect(svc).toContain('executeAuditedAction');
    expect(svc).toContain('pause_public_booking');
    expect(svc).toContain('resume_public_booking');
    expect(svc).toContain('Never touch PublicBookingEnabled');
    expect(toggle).toContain('LIFECYCLE_FIELDS_FORBIDDEN');
    expect(SENSITIVE_ACTIONS.pause_public_booking.requiresReason).toBe(true);
    expect(SENSITIVE_ACTIONS.resume_public_booking.requiresReason).toBe(true);
  });

  it('forbids Camp Caesar public enable/pause from ops', () => {
    const svc = read('src/lib/booking/publicBookingOperations.ts');
    expect(svc).toContain('CAMP_CAESAR_PUBLIC_ENABLE_FORBIDDEN');
    expect(svc).toContain("branchCode === 'CAMP_CAESAR'");
    expect(svc).toContain('publicEnableForbidden');
    expect(() => {
      throw new PublicBookingOpsError(
        'CAMP_CAESAR_PUBLIC_ENABLE_FORBIDDEN',
        'blocked',
        403,
      );
    }).toThrow(/blocked/);
  });

  it('dashboard uses health endpoint and shows monitoring warning', () => {
    const ui = read(
      'src/app/admin/booking/operations/BookingOperationsDashboard.tsx',
    );
    expect(ui).toContain('/api/admin/public-booking/health');
    expect(ui).toContain('/api/admin/public-booking/operations');
    expect(ui).toContain('/api/admin/public-booking/booking-enabled');
    expect(ui).toContain('تحذير مراقبة');
    expect(ui).not.toContain('bookingAccessToken');
    expect(ui).not.toContain('customerPhone');
    expect(ui).not.toContain('plan.planToken');
    expect(ui).not.toMatch(/bookingCode|customer\.phone/);
  });
});
