import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..', '..');
function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('phase1rEmployeeScheduleEntryPoint', () => {
  it('HR employees page exposes schedule entry point', () => {
    const hr = read('src/app/admin/hr/page.tsx');
    expect(hr).toContain('الفروع ومواعيد العمل');
    expect(hr).toContain('/admin/hr/employees/');
    expect(hr).toContain('branch-schedule');
    expect(hr).toContain('CalendarRange');
    expect(hr).toContain('إدارة العمل');
  });
});

describe('phase1rEmployeeWeeklyPlanner', () => {
  it('weekly planner uses empId param and global days save contract', () => {
    const page = read('src/app/admin/hr/employees/[empId]/branch-schedule/page.tsx');
    expect(page).toContain('useParams<{ empId: string }>');
    expect(page).toContain('مواعيد وفروع الموظف');
    expect(page).toContain('استخدام ساعات الفرع');
    expect(page).toContain('معاينة تأثير الجدول');
    expect(page).toContain('/branch-schedule/preview');

    const save = read('src/lib/hr/employeeGlobalWeeklyScheduleSave.ts');
    expect(save).toContain('saveEmployeeGlobalWeeklySchedule');
    expect(save).toContain('previewEmployeeGlobalWeeklySchedule');
    expect(save).toContain('TblEmpBranchWorkSchedule');
    expect(save).not.toMatch(/INSERT INTO dbo\.TblEmpWorkSchedule/i);
    expect(save).not.toMatch(/UPDATE dbo\.TblEmpWorkSchedule/i);
    expect(save).toContain('SCHEDULE_AFFECTS_EXISTING_BOOKINGS');
    expect(save).toContain('EMPLOYEE_MULTI_BRANCH_SAME_WORKDAY_NOT_ALLOWED');
  });

  it('branch-schedule API accepts global days[] and preview route exists', () => {
    const route = read('src/app/api/admin/employees/[id]/branch-schedule/route.ts');
    expect(route).toContain('saveEmployeeGlobalWeeklySchedule');
    expect(route).toContain('body.days');
    const preview = read(
      'src/app/api/admin/employees/[id]/branch-schedule/preview/route.ts',
    );
    expect(preview).toContain('previewEmployeeGlobalWeeklySchedule');
  });
});

describe('phase1rOperationsDayState', () => {
  it('day-state service uses resolvers not attendance inference alone', () => {
    const s = read('src/lib/hr/operationsDayState.ts');
    expect(s).toContain('listOperationalPresenceForBranch');
    expect(s).toContain('TblEmpBranchWorkSchedule');
    expect(s).toContain('TblEmpTemporaryBranchTransfer');
    expect(s).toContain('transferred_in');
    expect(s).toContain('نقل طارئ');
    // Must stay batched — no per-employee resolveEmployee* loops
    expect(s).not.toContain('resolveEmployeeGlobalSchedule');
    expect(s).not.toContain('resolveEmployeeBranchSchedule');
    const api = read('src/app/api/operations/employees/day-state/route.ts');
    expect(api).toContain('loadOperationsDayState');
  });

  it('schedule-control modal loads resolver-backed day state fields', () => {
    const modal = read('src/components/operations/ScheduleControlModal.tsx');
    expect(modal).toContain('نقل اليوم لفرع آخر');
    expect(modal).toContain('إلغاء النقل الطارئ');
    expect(modal).toContain('temporary-transfer');
    expect(modal).toContain('isTransferred');
    const ctrl = read('src/app/api/operations/schedule-control/route.ts');
    expect(ctrl).toContain('loadOperationsDayState');
    expect(ctrl).toContain('transferDestinations');
    expect(ctrl).toMatch(/lifecycleStatus\s*!==\s*['"]SETUP['"]/);
  });
});

describe('phase1rTemporaryTransferPreview', () => {
  it('preview returns structured blockers and never trusts client FromBranchID', () => {
    const t = read('src/lib/hr/temporaryBranchTransfer.ts');
    expect(t).toContain('previewTemporaryBranchTransfer');
    expect(t).toContain('TEMPORARY_TRANSFER_HAS_SOURCE_BOOKINGS');
    expect(t).toContain('TRANSFER_ATTENDANCE_CONFLICT');
    expect(t).toContain('TRANSFER_ACTIVE_SERVICE_CONFLICT');
    expect(t).toContain('TRANSFER_PAYROLL_ALREADY_GENERATED');
    expect(t).toContain('TRANSFER_GLOBAL_LEAVE_BLOCKS');
    expect(t).toContain('TRANSFER_DESTINATION_NOT_OPERATIONAL');
    expect(t).toContain('TRANSFER_FROM_BRANCH_MISMATCH');
    expect(t).toContain('resolveFreelanceOperationalSource');
    expect(t).toContain('provisionFreelanceDestinationForTransfer');
    expect(t).toContain('cancelTemporaryBranchTransfer');
    expect(t).toContain('IsActive = 0');
    expect(t).not.toMatch(/DELETE FROM dbo\.TblEmpTemporaryBranchTransfer/);
  });
});

describe('phase1rTemporaryTransferApplyCancel', () => {
  it('ops transfer APIs exist for preview apply cancel', () => {
    expect(
      fs.existsSync(
        path.join(
          root,
          'src/app/api/operations/employees/[empId]/temporary-transfer/preview/route.ts',
        ),
      ),
    ).toBe(true);
    const apply = read(
      'src/app/api/operations/employees/[empId]/temporary-transfer/route.ts',
    );
    expect(apply).toContain('createTemporaryBranchTransfer');
    expect(apply).toContain('cancelTemporaryBranchTransfer');
    expect(apply).toContain('fromBranchId');
  });
});

describe('phase1rTransferConflictGuards', () => {
  it('documents conflict policy and source booking block', () => {
    const t = read('src/lib/hr/temporaryBranchTransfer.ts');
    expect(t).toContain('TEMPORARY_TRANSFER_HAS_SOURCE_BOOKINGS');
    expect(t).toContain('TRANSFER_DESTINATION_NOT_OPERATIONAL');
    const policy = read('src/lib/hr/empBranchWorkSchedule.ts');
    expect(policy).toContain('ONE_OPERATIONAL_BRANCH_PER_EMPLOYEE_PER_WORKDATE');
  });
});

describe('phase1rFlowBoardTransferIntegration', () => {
  it('flow-board filters by resolved operational location', () => {
    const fbRoute = read('src/app/api/operations/flow-board/route.ts');
    const fbSvc = read('src/lib/operations/loadFlowBoardForBranch.ts');
    expect(fbRoute).toContain('loadFlowBoardForBranch');
    expect(fbSvc).toContain('listOperationalPresenceForBranch');
    expect(fbSvc).toContain('isEmergencyTransfer');
    expect(fbRoute).not.toContain('resolveEmployeeBranchSchedule');
    const day = read('src/lib/hr/operationsDayState.ts');
    expect(day).toContain('listOperationalPresenceForBranch');
    expect(day).not.toMatch(/for \(const b of barbers\.recordset\)[\s\S]*resolveEmployeeGlobalSchedule/);
  });
});

describe('phase1rBookingAttendancePayrollIntegration', () => {
  it('booking and attendance remain resolver-backed after transfer module', () => {
    const create = read('src/app/api/public/booking/create/route.ts');
    const evalr = read('src/lib/booking/publicBookingSelectionEvaluator.ts');
    expect(create).toContain('createPublicBooking');
    expect(evalr).toContain('BARBER_AVAILABLE_AT_DIFFERENT_BRANCH');
    const att = read('src/lib/hr/attendance/branchAttendance.service.ts');
    expect(att).toContain('EMPLOYEE_NOT_SCHEDULED_IN_THIS_BRANCH');
    expect(att).toContain('resolveEmployeeBranchSchedule');
  });
});

describe('phase1rTransferLifecycleSecurity', () => {
  it('Camp Caesar SETUP excluded from normal transfer destinations', () => {
    const ctrl = read('src/app/api/operations/schedule-control/route.ts');
    expect(ctrl).toContain('SETUP');
    expect(ctrl).toContain('transferDestinations');
    // Destinations are org-wide active branches; client excludes the from-branch
    expect(ctrl).toContain('All live operational branches');
    expect(ctrl).not.toMatch(
      /transferDestinations[\s\S]{0,400}canOperate \|\| a\.canSwitch/,
    );
    const inv = read('src/lib/hr/scheduleAvailabilityInvalidation.ts');
    expect(inv).toContain('invalidateTemporaryTransferCaches');
  });
});

describe('phase1rResponsiveUiContract', () => {
  it('planner is RTL with mobile-friendly day cards', () => {
    const page = read('src/app/admin/hr/employees/[empId]/branch-schedule/page.tsx');
    expect(page).toContain('dir="rtl"');
    expect(page).toContain('rounded-2xl');
    expect(page).toContain('sm:grid-cols');
    expect(page).toContain('نسخ لباقي أيام العمل');
    expect(page).toContain('استخدام مواعيد عمل الموظف المحفوظة');
  });
});
