#!/usr/bin/env npx tsx
/**
 * Phase 1R verifier — employee schedule UI + operations emergency transfer integration.
 */
import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';

function fail(msg: string): never {
  console.error('FAIL:', msg);
  process.exit(1);
}
function ok(msg: string) {
  console.log('OK:', msg);
}

const root = path.join(__dirname, '..');
function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}
function exists(rel: string) {
  return fs.existsSync(path.join(root, rel));
}

async function main() {
  const required = [
    'docs/branch-phase-1r-ui-integration-audit.md',
    'src/lib/hr/employeeGlobalWeeklyScheduleSave.ts',
    'src/lib/hr/operationsDayState.ts',
    'src/lib/hr/temporaryBranchTransfer.ts',
    'src/lib/hr/scheduleAvailabilityInvalidation.ts',
    'src/app/admin/hr/employees/[empId]/branch-schedule/page.tsx',
    'src/app/api/operations/employees/day-state/route.ts',
    'src/app/api/operations/employees/[empId]/temporary-transfer/route.ts',
    'scripts/verify-cross-branch-employee-scheduling-booking.ts',
  ];
  for (const f of required) {
    if (!exists(f)) fail(`missing ${f}`);
  }
  ok('required files');

  const hr = read('src/app/admin/hr/page.tsx');
  if (!hr.includes('الفروع ومواعيد العمل')) fail('Employee page has no schedule entry point');
  ok('employee page entry point');

  const globalSave = read('src/lib/hr/employeeGlobalWeeklyScheduleSave.ts');
  if (globalSave.includes('UPDATE dbo.TblEmpWorkSchedule') || globalSave.includes('INSERT INTO dbo.TblEmpWorkSchedule')) {
    fail('Weekly planner writes legacy global schedule');
  }
  ok('no legacy WorkSchedule writes from global save');

  const legacyScheduleRoute = read('src/app/api/admin/employees/[id]/schedule/route.ts');
  if (!legacyScheduleRoute.includes('LEGACY_EMP_WORK_SCHEDULE_WRITE_LOCKED')) {
    fail('Ordinary /schedule PUT is not write-locked');
  }
  if (
    /export async function PUT[\s\S]*INSERT INTO dbo\.TblEmpWorkSchedule/i.test(legacyScheduleRoute)
  ) {
    fail('Ordinary /schedule PUT still inserts into TblEmpWorkSchedule');
  }
  if (
    /export async function PUT[\s\S]*UPDATE dbo\.TblEmpWorkSchedule/i.test(legacyScheduleRoute)
  ) {
    fail('Ordinary /schedule PUT still updates TblEmpWorkSchedule');
  }
  ok('legacy /schedule PUT write-locked');

  const empModal = read('src/components/admin/EmployeeManagementModal.tsx');
  if (!empModal.includes('الفروع ومواعيد العمل')) {
    fail('Employee modal missing branch-schedule CTA');
  }
  ok('employee modal redirects to branch schedule');

  const dayState = read('src/lib/hr/operationsDayState.ts');
  if (!dayState.includes('listOperationalPresenceForBranch') || !dayState.includes('TblEmpBranchWorkSchedule')) {
    fail('Daily modal / presence missing batched branch schedule path');
  }
  if (dayState.includes('resolveEmployeeGlobalSchedule') || dayState.includes('resolveEmployeeBranchSchedule')) {
    fail('Daily modal reconstructs schedule via per-employee resolvers (N+1)');
  }
  ok('day-state uses batched schedule/transfer presence');

  const fb = read('src/app/api/operations/flow-board/route.ts');
  const fbLoader = exists('src/lib/operations/loadFlowBoardForBranch.ts')
    ? read('src/lib/operations/loadFlowBoardForBranch.ts')
    : '';
  if (
    !fb.includes('listOperationalPresenceForBranch') &&
    !fbLoader.includes('listOperationalPresenceForBranch')
  ) {
    fail('Flow-board not refreshed / not location-filtered');
  }
  if (fb.includes('resolveEmployeeBranchSchedule') || fbLoader.includes('resolveEmployeeBranchSchedule')) {
    fail('Flow-board still N+1 resolves per barber');
  }
  ok('flow-board location filter (batched)');

  const transfer = read('src/lib/hr/temporaryBranchTransfer.ts');
  if (!transfer.includes('previewTemporaryBranchTransfer')) fail('transfer preview missing');
  if (!transfer.includes('TRANSFER_FROM_BRANCH_MISMATCH')) fail('Transfer trusts browser FromBranchID');
  if (!transfer.includes('TEMPORARY_TRANSFER_HAS_SOURCE_BOOKINGS')) {
    fail('Source booking does not block transfer');
  }
  if (!transfer.includes('TRANSFER_ATTENDANCE_CONFLICT')) {
    fail('Open attendance does not block transfer');
  }
  if (!transfer.includes('TRANSFER_ACTIVE_SERVICE_CONFLICT')) {
    fail('Active queue does not block transfer');
  }
  if (!transfer.includes('TRANSFER_PAYROLL_ALREADY_GENERATED')) {
    fail('Payroll/ledger activity does not block transfer');
  }
  if (!transfer.includes('EMPLOYEE_NOT_ASSIGNED_TO_BRANCH')) {
    fail('Destination assignment not required');
  }
  if (!transfer.includes('EMPLOYEE_BRANCH_PAYROLL_PLAN_REQUIRED')) {
    fail('Destination payroll not required');
  }
  if (!transfer.includes('TRANSFER_GLOBAL_LEAVE_BLOCKS')) {
    fail('Transfer bypasses global leave');
  }
  if (/DELETE\s+FROM\s+dbo\.TblEmpTemporaryBranchTransfer/i.test(transfer)) {
    fail('Cancel hard-deletes history');
  }
  if (!transfer.includes('IsActive = 0')) fail('cancel must soft-deactivate');
  ok('transfer conflict + cancel policy');

  const modal = read('src/components/operations/ScheduleControlModal.tsx');
  if (!modal.includes('نقل اليوم لفرع آخر')) fail('ops modal missing transfer action');
  if (!modal.includes('temporary-transfer')) fail('ops modal not wired to transfer API');
  ok('ops modal transfer UI');

  const booking = read('src/app/api/public/booking/create/route.ts');
  if (!booking.includes('BARBER_AVAILABLE_AT_DIFFERENT_BRANCH')) {
    fail('Booking availability ignores transfer');
  }
  const att = read('src/lib/hr/attendance/branchAttendance.service.ts');
  if (!att.includes('resolveEmployeeBranchSchedule')) {
    fail('Attendance ignores transfer');
  }
  ok('booking/attendance integration');

  const ctrl = read('src/app/api/operations/schedule-control/route.ts');
  if (!ctrl.includes('lifecycleStatus !== "SETUP"') && !ctrl.includes("lifecycleStatus !== 'SETUP'")) {
    fail('Camp Caesar appears in normal operations while SETUP');
  }
  ok('SETUP destinations excluded from normal transfer list');

  const inv = read('src/lib/hr/scheduleAvailabilityInvalidation.ts');
  if (!inv.includes('invalidateTemporaryTransferCaches')) {
    fail('Cache invalidation missing');
  }
  ok('cache invalidation hooks');

  const nested = spawnSync(
    'npx',
    ['tsx', 'scripts/verify-cross-branch-employee-scheduling-booking.ts'],
    { cwd: root, encoding: 'utf8', shell: true },
  );
  if (nested.status !== 0) {
    console.error(nested.stdout);
    console.error(nested.stderr);
    fail('Phase 1Q nested verifier failed');
  }
  ok('nested Phase 1Q verifier');

  console.log('\nPhase 1R verifier PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
