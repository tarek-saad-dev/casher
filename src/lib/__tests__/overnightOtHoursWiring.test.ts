import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..', '..');
function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('overnight OT hours wiring', () => {
  it('defers overnight checkout fill and syncs payroll on attendance save', () => {
    const finalize = read('src/lib/hr/finalize-incomplete-attendance.ts');
    expect(finalize).toContain('shouldDeferOvernightDefaultCheckoutFill');
    expect(finalize).toContain('deferOvernightCheckout');

    const nightly = read('src/lib/hr/nightly-close.service.ts');
    expect(nightly).toContain('shiftYmd(workDate, -1)');

    const attendanceApi = read('src/app/api/admin/attendance/route.ts');
    expect(attendanceApi).toContain('syncNonPostedPayrollHoursFromAttendance');

    const monthly = read('src/lib/reports/employee-monthly-payroll.ts');
    expect(monthly).toContain('liveHours');
    expect(monthly).toContain('Prefer live punches');

    expect(
      fs.existsSync(path.join(root, 'src/lib/payroll/syncPayrollHoursFromAttendance.ts')),
    ).toBe(true);
  });
});
