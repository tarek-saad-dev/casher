import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('Cashier-assisted extra-service transfer safety contracts', () => {
  const service = read('src/lib/booking/addonTransfer.ts');
  const busy = read('src/lib/scheduleIntegrity.ts');
  const handoff = read('src/lib/booking/cashierHandoff.ts');
  const original = read('src/lib/employee-portal/bookingAddonAvailability.ts');

  it('requires cashier approval and creates a real alternate reservation in one transaction', () => {
    expect(service).toContain('ISOLATION_LEVEL.SERIALIZABLE');
    expect(service).toContain('acquireEmployeeScheduleLock');
    expect(service).toContain('assertEmployeeIntervalAvailable');
    expect(service).toContain('WITH (UPDLOCK,HOLDLOCK)');
    expect(service).toContain('OUTPUT INSERTED.BookingServiceID');
    expect(service).toContain("SET Status=N'assigned'");
    expect(service).toContain('BookingServiceID=@line');
    expect(service.indexOf('await assertEmployeeIntervalAvailable({', service.indexOf('export async function assignAddonTransfer')))
      .toBeLessThan(service.indexOf('INSERT INTO dbo.BookingServices'));
    expect(service).toContain('await tx.rollback()');
  });

  it('blocks alternate reservations in the same canonical occupancy engine as normal bookings', () => {
    expect(busy).toContain("OBJECT_ID(N'dbo.TblBookingAddonTransferRequest',N'U')");
    expect(busy).toContain("Status=N'assigned'");
    expect(busy).toContain('...addonIntervals');
    expect(busy).toContain('transaction: args.transaction');
  });

  it('does not extend the original barber when a second employee receives the extra service', () => {
    expect(original).toContain('bs.EmpID=b.AssignedEmpID OR bs.EmpID IS NULL');
    expect(service).not.toContain('UPDATE dbo.Bookings SET EndTime=');
  });

  it('preserves the performing employee and blocks unapproved service before sale', () => {
    expect(handoff).toContain('ISNULL(bs.EmpID,b.AssignedEmpID) AS EmpID');
    expect(handoff).toContain("error: 'pending_transfer'");
    expect(handoff).toContain('services_not_reserved');
    expect(handoff).toContain('remaining > 0');
  });

  it('uses employee authentication for request, and authorized active cashier branch for approval', () => {
    const staff = read('src/app/api/employee-portal/bookings/[id]/addon/transfer-request/route.ts');
    expect(staff).toContain('getEmployeePortalIdentity');
    expect(staff).toContain('mustChangePassword');
    const route = read('src/app/api/pos/addon-transfers/[id]/assign/route.ts');
    expect(route).toContain("requirePageAccess('/income/pos')");
    expect(route).toContain('resolveBranchDayAndShiftForWrite');
    expect(route).toContain('getSession');
    expect(route).toContain('assignAddonTransfer');
  });

  it('has a cashier transfer queue and a staff request CTA', () => {
    const ui = read('src/components/pos/AddonTransferInbox.tsx');
    expect(ui).toContain('اختيار موظف بديل');
    expect(ui).toContain('تأكيد الحجز');
    const staffUI = read('src/app/employee-portal/bookings/booking-handoff-sheet.tsx');
    expect(staffUI).toContain('إرسال طلب تحويل الخدمة للكاشير');
  });
});
