import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  FORCEABLE_TRANSFER_BLOCKER_CODES,
  RELOCATABLE_TRANSFER_BLOCKER_CODES,
  splitTransferBlockers,
} from '@/lib/hr/temporaryTransferBlockers';

const root = path.join(__dirname, '..', '..', '..');
function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('hrBranchTransferPageWiring', () => {
  it('exposes full HR branch-transfer page, nav, and registry', () => {
    expect(
      fs.existsSync(path.join(root, 'src/app/admin/hr/branch-transfer/page.tsx')),
    ).toBe(true);
    const page = read('src/components/hr/BranchTransferPage.tsx');
    expect(page).toContain('نقل موظف بين الفروع');
    expect(page).toContain('relocateAttendance');
    expect(page).toContain('/api/admin/hr/branch-transfer');
    expect(page).toContain('تاريخ قديم');

    const nav = read('src/components/layout/nav-config.ts');
    expect(nav).toContain('/admin/hr/branch-transfer');
    expect(nav).toContain('نقل بين الفروع');

    const registry = read('src/lib/pages-registry.ts');
    expect(registry).toContain('hr.branch_transfer');
    expect(registry).toContain('/admin/hr/branch-transfer');

    const auth = read('src/lib/api-auth.ts');
    expect(auth).toContain('requireTemporaryTransferAccess');
  });

  it('HR transfer APIs support list preview apply cancel and relocate', () => {
    expect(
      fs.existsSync(path.join(root, 'src/app/api/admin/hr/branch-transfer/route.ts')),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(root, 'src/app/api/admin/hr/branch-transfer/preview/route.ts'),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(root, 'src/app/api/admin/hr/branch-transfer/meta/route.ts'),
      ),
    ).toBe(true);

    const route = read('src/app/api/admin/hr/branch-transfer/route.ts');
    expect(route).toContain('listTemporaryBranchTransfers');
    expect(route).toContain('createTemporaryBranchTransfer');
    expect(route).toContain('cancelTemporaryBranchTransfer');
    expect(route).toContain('relocateAttendance');
    expect(route).toContain('requireTemporaryTransferAccess');
  });
});

describe('temporaryTransferPastDateRelocatePolicy', () => {
  it('treats completed attendance and generated payroll as relocatable', () => {
    expect(RELOCATABLE_TRANSFER_BLOCKER_CODES.has('TRANSFER_ATTENDANCE_COMPLETED')).toBe(
      true,
    );
    expect(
      RELOCATABLE_TRANSFER_BLOCKER_CODES.has('TRANSFER_PAYROLL_ALREADY_GENERATED'),
    ).toBe(true);
    expect(FORCEABLE_TRANSFER_BLOCKER_CODES.has('TEMPORARY_TRANSFER_HAS_SOURCE_BOOKINGS')).toBe(
      true,
    );

    const blockers = [
      { code: 'TRANSFER_ATTENDANCE_COMPLETED', message: 'att' },
      { code: 'TRANSFER_PAYROLL_ALREADY_GENERATED', message: 'pay' },
      { code: 'EMPLOYEE_NOT_ASSIGNED_TO_BRANCH', message: 'asg' },
      { code: 'TRANSFER_ATTENDANCE_CONFLICT', message: 'open' },
    ];

    const without = splitTransferBlockers(blockers, { relocateAttendance: false });
    expect(without.relocatable.map((b) => b.code)).toEqual([
      'TRANSFER_ATTENDANCE_COMPLETED',
      'TRANSFER_PAYROLL_ALREADY_GENERATED',
    ]);
    expect(without.soft.map((b) => b.code)).toEqual(['EMPLOYEE_NOT_ASSIGNED_TO_BRANCH']);
    expect(without.hard.map((b) => b.code)).toEqual([
      'TRANSFER_ATTENDANCE_COMPLETED',
      'TRANSFER_PAYROLL_ALREADY_GENERATED',
      'TRANSFER_ATTENDANCE_CONFLICT',
    ]);

    const withRelocate = splitTransferBlockers(blockers, { relocateAttendance: true });
    expect(withRelocate.soft.map((b) => b.code).sort()).toEqual(
      [
        'EMPLOYEE_NOT_ASSIGNED_TO_BRANCH',
        'TRANSFER_ATTENDANCE_COMPLETED',
        'TRANSFER_PAYROLL_ALREADY_GENERATED',
      ].sort(),
    );
    expect(withRelocate.hard.map((b) => b.code)).toEqual(['TRANSFER_ATTENDANCE_CONFLICT']);
  });

  it('core service documents relocate helpers and past-date codes', () => {
    const t = read('src/lib/hr/temporaryBranchTransfer.ts');
    expect(t).toContain('RELOCATABLE_TRANSFER_BLOCKER_CODES');
    expect(t).toContain('TRANSFER_ATTENDANCE_COMPLETED');
    expect(t).toContain('TRANSFER_PAYROLL_ALREADY_POSTED');
    expect(t).toContain('canForceWithRelocate');
    expect(t).toContain('relocateAttendanceAndPayrollForTransfer');
    expect(t).toContain('listTemporaryBranchTransfers');
    expect(t).toContain('relocatedAttendance');
  });
});
