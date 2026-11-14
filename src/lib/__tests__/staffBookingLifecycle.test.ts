import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const read = (name: string) => fs.readFileSync(path.join(process.cwd(), name), 'utf8');

import { STAFF_BOOKING_TRANSITIONS } from '@/lib/employee-portal/bookingLifecycle';

describe('employee booking lifecycle', () => {
  it('has three strictly ordered state transitions without marking an invoice paid', () => {
    expect(STAFF_BOOKING_TRANSITIONS).toEqual({
      arrive: { previous: 'scheduled', next: 'arrived' },
      start: { previous: 'arrived', next: 'in_service' },
      finish: { previous: 'in_service', next: 'finished' },
    });
    expect(Object.values(STAFF_BOOKING_TRANSITIONS).some(t => t.next === 'completed')).toBe(false);
  });

  it('requires tenant-employee ownership and an atomic compare-and-set', () => {
    const service = read('src/lib/employee-portal/bookingLifecycle.ts');
    expect(service).toContain('ISOLATION_LEVEL.SERIALIZABLE');
    expect(service).toContain('WITH (UPDLOCK, HOLDLOCK)');
    expect(service).toContain('b.AssignedEmpID=@empId');
    expect(service).toContain('e.TenantId=@tenantId');
    expect(service).toContain('Phase=@previous');
    expect(service).toContain('handoff');
    expect(service).toContain('await tx.rollback()');
  });

  it('rejects sending to cashier until the service is marked finished by server', () => {
    const route = read('src/app/api/employee-portal/bookings/[id]/handoff/route.ts');
    expect(route).toContain("phase !== 'finished'");
    expect(route).toContain('getStaffBookingPhase');
  });

  it('exposes only masked client information and adds three UI actions', () => {
    const api = read('src/app/api/employee-portal/bookings/[id]/lifecycle/route.ts');
    expect(api).toContain('getEmployeePortalIdentity');
    expect(api).toContain('mustChangePassword');
    const sheet = read('src/app/employee-portal/bookings/booking-handoff-sheet.tsx');
    expect(sheet).toContain('تأكيد وصول العميل');
    expect(sheet).toContain('بدء الخدمة');
    expect(sheet).toContain('إنهاء الخدمة');
    expect(sheet).toContain("staffPhase !== 'finished'");
    const masked = read('src/lib/employee-portal/bookingPrivacy.ts');
    expect(masked).not.toContain('clientPhone');
  });
});
