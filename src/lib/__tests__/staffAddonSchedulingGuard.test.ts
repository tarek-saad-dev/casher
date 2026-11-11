import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (name: string) => fs.readFileSync(path.join(process.cwd(), name), 'utf8');

describe('CUT STAFF safe extra-service workflow', () => {
  const api = read('src/app/api/employee-portal/bookings/[id]/addon/route.ts');
  const guard = read('src/lib/employee-portal/bookingAddonAvailability.ts');
  const modal = read('src/app/employee-portal/bookings/booking-handoff-sheet.tsx');
  const cashier = read('src/lib/booking/cashierHandoff.ts');

  it('requires an employee session for preview and commit; never trusts client duration or price', () => {
    expect(api).toContain('getEmployeePortalIdentity');
    expect(api).toContain('mustChangePassword');
    expect(api).toContain('previewAddon');
    expect(api).toContain('reserveAddon');
    expect(guard).toContain('e.TenantId=@tenant');
    expect(guard).toContain('e.isActive=1');
    expect(guard).toContain('DurationMinutes');
    expect(guard).toContain('SPrice1');
    expect(guard).toContain('isDeleted,0)=0');
    expect(guard).not.toContain('input.price');
    expect(guard).not.toContain('input.durationMinutes');
  });

  it('reserves time inside a serializable transaction with a fresh authoritative schedule guard', () => {
    expect(guard).toContain('ISOLATION_LEVEL.SERIALIZABLE');
    expect(guard).toContain('acquireEmployeeScheduleLock');
    expect(guard).toContain('WITH (UPDLOCK, HOLDLOCK)');
    expect(guard).toContain('expected.getTime()');
    expect(guard).toContain('assertEmployeeIntervalAvailable({');
    const lastGuard = guard.lastIndexOf('await assertEmployeeIntervalAvailable({');
    const update = guard.indexOf('UPDATE dbo.Bookings SET EndTime=');
    const insert = guard.indexOf('INSERT INTO dbo.BookingServices');
    const commit = guard.indexOf('await tx.commit()');
    expect(lastGuard).toBeLessThan(update);
    expect(update).toBeLessThan(insert);
    expect(insert).toBeLessThan(commit);
    expect(guard).toContain('await tx.rollback()');
    expect(guard).toContain('bookingOccupancyChanged');
    expect(guard).toContain('مدة الحجز المسجلة غير متطابقة');
    expect(guard).toContain('derivedEnd.getTime() - endAt.getTime()');
  });

  it('only suggests alternative staff, never auto-reserves without cashier confirmation', () => {
    expect(guard).toContain('alternatives(');
    expect(guard).toContain("assertEmployeeIntervalAvailable({");
    expect(modal).toContain('اقتراح غير محجوز');
    expect(modal).toContain('وجّه العميل للكاشير');
  });

  it('does not allow POS handoff of service quantities without booked time', () => {
    expect(cashier).toContain('SUM(ISNULL(Qty,1)) AS Qty');
    expect(cashier).toContain('services_not_reserved');
    const handoffRoute = read('src/app/api/employee-portal/bookings/[id]/handoff/route.ts');
    expect(handoffRoute).toContain('services_not_reserved');
  });

  it('never appends selected services to handoff in the browser before server confirmation', () => {
    expect(modal).toContain("method: 'POST'");
    expect(modal).toContain('expectedEndAt');
    expect(modal).toContain('await loadDetail()');
    expect(modal).not.toContain("source: 'added',");
    expect(modal).toContain('الوقت مش متاح عندك');
  });
});
