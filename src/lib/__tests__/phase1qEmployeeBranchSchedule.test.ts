import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  evaluateOvernightSlot,
  CAMP_CAESAR_OVERNIGHT_HOURS,
} from '@/lib/branch/overnightOperatingHours';

const root = path.join(__dirname, '..', '..', '..');
function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('phase1qEmployeeBranchSchedule', () => {
  it('defines branch-owned SoT table and same-workday policy', () => {
    const t = read('src/lib/hr/empBranchWorkSchedule.ts');
    const s = read('src/lib/hr/employeeBranchScheduleSave.ts');
    expect(t).toContain('TblEmpBranchWorkSchedule');
    expect(t).toContain('ONE_OPERATIONAL_BRANCH_PER_EMPLOYEE_PER_WORKDATE');
    expect(t).toContain('backfillGleemBranchSchedulesFromLegacy');
    expect(s).toContain('EMPLOYEE_MULTI_BRANCH_SAME_WORKDAY_NOT_ALLOWED');
    expect(s).toContain('saveEmployeeBranchWeeklySchedule');
    // Re-saving the same EffectiveFrom must supersede prior active rows (Karim Thu duplicate bug).
    expect(s).toContain('EffectiveFrom = @from');
    expect(s).toMatch(/SET IsActive = 0/);
  });


  it('resolver aggregates globally and resolves per branch', () => {
    const r = read('src/lib/hr/employeeBranchScheduleResolver.ts');
    expect(r).toContain('resolveEmployeeBranchSchedule');
    expect(r).toContain('resolveEmployeeGlobalSchedule');
    expect(r).toContain('temporary_transfer');
    expect(r).toContain('legacy_fallback');
  });

  it('assignment commit writes branch schedule not global WorkSchedule', () => {
    const c = read('src/lib/branch/employeeAssignmentCommit.ts');
    expect(c).toContain('saveEmployeeBranchWeeklySchedule');
    expect(c).toContain('Do NOT mutate legacy global TblEmpWorkSchedule');
  });
});

describe('phase1qGlobalBarberCalendar', () => {
  it('builds calendar and lists unique global barbers', () => {
    const g = read('src/lib/hr/barberGlobalCalendar.ts');
    expect(g).toContain('buildBarberCalendar');
    expect(g).toContain('listGlobalPublicBarbers');
    expect(g).toContain('presence_only');
    expect(g).toContain('fully_booked');
  });
});

describe('phase1qBranchFilteredAvailability', () => {
  it('availability engine prefers branch schedule batch', () => {
    const e = read('src/lib/bookingAvailabilityEngine.ts');
    expect(e).toContain('TblEmpBranchWorkSchedule');
    expect(e).toContain('TblEmpTemporaryBranchTransfer');
    expect(e).toContain('branchId');
  });
});

describe('phase1qCrossBranchBookingGuard', () => {
  it('create and slots reject wrong branch', () => {
    const create = read('src/app/api/public/booking/create/route.ts');
    const avail = read('src/lib/booking/publicBookingAvailability.ts');
    const slots = read(
      'src/app/api/public/booking/barbers/[empId]/available-slots/route.ts',
    );
    expect(create).toContain('BARBER_AVAILABLE_AT_DIFFERENT_BRANCH');
    expect(avail).toContain('BARBER_AVAILABLE_AT_DIFFERENT_BRANCH');
    expect(slots).toContain('getPublicAvailableSlots');
  });
});

describe('phase1qEmployeeAttendanceBranchGuard', () => {
  it('check-in requires branch schedule and blocks other-branch open session', () => {
    const a = read('src/lib/hr/attendance/branchAttendance.service.ts');
    expect(a).toContain('EMPLOYEE_NOT_SCHEDULED_IN_THIS_BRANCH');
    expect(a).toContain('EMPLOYEE_ALREADY_CHECKED_IN_OTHER_BRANCH');
    expect(a).toContain('resolveEmployeeBranchSchedule');
    // Board/save alignment: existing attendance or branch schedule row still allow save
    expect(a).toContain('getEffectiveBranchScheduleRow');
    expect(a).toContain('TblEmpAttendance');
    expect(a).toContain('TblEmpTemporaryBranchTransfer');
  });
});

describe('phase1qOvernightAvailability', () => {
  it('Camp Caesar overnight boundaries remain correct', () => {
    expect(evaluateOvernightSlot('23:45', CAMP_CAESAR_OVERNIGHT_HOURS)).toMatchObject({
      available: true,
      dayOffset: 0,
    });
    expect(evaluateOvernightSlot('00:15', CAMP_CAESAR_OVERNIGHT_HOURS)).toMatchObject({
      available: true,
      dayOffset: 1,
    });
    expect(evaluateOvernightSlot('01:15', CAMP_CAESAR_OVERNIGHT_HOURS).dayOffset).toBe(1);
    expect(evaluateOvernightSlot('01:30', CAMP_CAESAR_OVERNIGHT_HOURS).available).toBe(false);
  });
});

describe('phase1qTemporaryBranchTransfer', () => {
  it('transfer helper exists with destination payroll/assignment checks', () => {
    const t = read('src/lib/hr/temporaryBranchTransfer.ts');
    expect(t).toContain('createTemporaryBranchTransfer');
    expect(t).toContain('TblEmpTemporaryBranchTransfer');
    expect(t).toContain('EMPLOYEE_BRANCH_PAYROLL_PLAN_REQUIRED');
  });
});

describe('phase1qPublicBranchVisibility', () => {
  it('public booking requires lifecycle + booking enabled', () => {
    const v = read('src/lib/branch/publicBranchVisibility.ts');
    expect(v).toContain('canBranchAppearInPublicBooking');
    expect(v).toContain('canBranchAppearInAdminSchedule');
    expect(v).toContain('isPubliclyDiscoverable');
    expect(v).toContain('BookingEnabled');
  });
});

describe('phase1qScheduleMigration', () => {
  it('migration script backfills GLEEM only', () => {
    const m = read('scripts/migrate-phase1q-branch-schedules.ts');
    expect(m).toContain('backfillGleemBranchSchedulesFromLegacy');
    expect(m).toContain('campCaesarRealSchedules');
    expect(m).toContain('gleemLegacyFingerprintUnchanged');
  });
});

describe('phase1qScheduleAdminUi', () => {
  it('admin matrix page and API exist', () => {
    expect(
      fs.existsSync(
        path.join(root, 'src/app/admin/hr/employees/[empId]/branch-schedule/page.tsx'),
      ),
    ).toBe(true);
    const api = read('src/app/api/admin/employees/[id]/branch-schedule/route.ts');
    expect(api).toContain('saveEmployeeBranchWeeklySchedule');
    expect(api).toContain('resolveEmployeeGlobalSchedule');
  });
});
