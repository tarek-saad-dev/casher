import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..', '..');
function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('relocateEmployeeDayBranch wiring', () => {
  it('exposes relocate-day API and daily-payroll row action', () => {
    expect(
      fs.existsSync(
        path.join(root, 'src/app/api/admin/hr/daily-payroll/relocate-branch/route.ts'),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(root, 'src/lib/hr/relocateEmployeeDayBranch.ts')),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(root, 'src/components/hr/MoveEmployeeDayBranchModal.tsx'),
      ),
    ).toBe(true);

    const svc = read('src/lib/hr/relocateEmployeeDayBranch.ts');
    expect(svc).toContain('previewRelocateEmployeeDayBranch');
    expect(svc).toContain('TblEmpAttendance');
    expect(svc).toContain('TblEmpDailyPayroll');
    expect(svc).toContain('TblEmpDailyTarget');
    expect(svc).toContain('RELOCATE_PAYROLL_POSTED');

    const panel = read('src/components/hr/DailyPayrollPanel.tsx');
    expect(panel).toContain('MoveEmployeeDayBranchModal');
    expect(panel).toContain('نقل لفرع آخر');

    const modal = read('src/components/hr/MoveEmployeeDayBranchModal.tsx');
    expect(modal).toContain('/api/admin/hr/daily-payroll/relocate-branch');
  });
});
