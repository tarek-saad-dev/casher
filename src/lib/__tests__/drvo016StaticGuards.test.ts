/**
 * DRVO-016 static guards: HR / attendance / payroll / employee-ledger code reads and writes
 * TblEmp only with a TenantId predicate, carries no CUT branch codes outside the policy module,
 * and the one-off Youssef ops code is gone.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const rel = (f: string) => path.relative(ROOT, f).replace(/\\/g, '/');

function walk(dir: string, out: string[] = []): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const full = path.join(abs, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      walk(rel(full), out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(rel(full));
    }
  }
  return out;
}

const OWNED_DIRS = [
  'src/lib/hr',
  'src/lib/payroll',
  'src/modules/attendance',
  'src/app/api/employees',
  'src/app/api/admin/employees',
  'src/app/api/admin/attendance',
  'src/app/api/admin/hr',
  'src/app/api/payroll',
  'src/app/api/deductions',
  'src/app/api/expenses/distribute',
  'src/app/api/pos/team-attendance',
];

const OWNED_FILES = [
  ...OWNED_DIRS.flatMap((d) => walk(d)),
  ...walk('src/lib/services').filter((f) => /\/employee[^/]*\.ts$/.test(f)),
  ...walk('src/lib/reports').filter((f) => /\/employee-monthly-[^/]*\.ts$|\/employeeMonthlyQuickReview\.ts$/.test(f)),
  'src/lib/accounting/accountingSettingsService.ts',
  'src/lib/types/employee-ledger.ts',
  'src/app/api/admin/manager-closing/status/route.ts',
].sort();

/**
 * Schema maintenance (ALTER / sys.columns) never reads or writes employee rows; the dev-only
 * migration route is gated by requireDevelopmentAdmin and only adds columns (plus a row-local backfill).
 */
const SCHEMA_ONLY_FILES = new Set(['src/app/api/admin/employees/migration/route.ts']);

const TBL_EMP_DML = /\b(?:FROM|JOIN|UPDATE|INTO)\s+(?:\[?dbo\]?\.)?\[?TblEmp\]?(?![\w])/;
/** A literal TenantId predicate, or an interpolated fragment from bindEmpTenantPredicate (`${...TenantSql}`). */
const TENANT_BOUND = /\bTenantId\b|\$\{\s*\w*[tT]enant\w*\s*\}/;

function sqlLiterals(text: string): string[] {
  return [...text.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
}

const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

describe('DRVO-016 owned surface', () => {
  it('covers the HR / payroll / ledger files', () => {
    expect(OWNED_FILES.length).toBeGreaterThan(100);
    expect(OWNED_FILES).toContain('src/lib/services/employeeLedgerPayoutService.ts');
    expect(OWNED_FILES).toContain('src/lib/payroll/dailyPayrollGenerateCore.ts');
    expect(OWNED_FILES).toContain('src/modules/attendance/infra/AttendanceRepository.ts');
  });
});

describe('DRVO-016 TblEmp access carries TenantId', () => {
  it('every SQL literal that reads or writes TblEmp in an owned file names TenantId', () => {
    const offenders: string[] = [];
    for (const file of OWNED_FILES) {
      if (SCHEMA_ONLY_FILES.has(file)) continue;
      const text = read(file);
      for (const lit of sqlLiterals(text)) {
        if (TBL_EMP_DML.test(lit) && !TENANT_BOUND.test(lit)) {
          const line = text.slice(0, text.indexOf(lit)).split('\n').length;
          offenders.push(`${file}:${line}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the schema-only route really is schema-only', () => {
    for (const file of SCHEMA_ONLY_FILES) {
      const text = read(file);
      expect(text).toContain('requireDevelopmentAdmin(');
      for (const lit of sqlLiterals(text)) {
        expect(lit, file).not.toMatch(/\b(?:FROM|JOIN|INTO)\s+(?:dbo\.)?TblEmp(?![\w])/i);
        if (/\bUPDATE\s+(?:dbo\.)?TblEmp\s+SET\b/i.test(lit)) {
          // Only the row-local WhatsApp <- Mobile backfill: it copies a column within each row.
          expect(lit.replace(/\s+/g, ' ').trim(), file).toBe(
            "UPDATE dbo.TblEmp SET WhatsApp = NULLIF(LTRIM(RTRIM(Mobile)), N'') WHERE WhatsApp IS NULL AND Mobile IS NOT NULL AND LTRIM(RTRIM(Mobile)) <> N'';",
          );
        }
      }
    }
  });

  it('the employee list / by-id selects are tenant-bound', () => {
    const db = read('src/lib/hr/employee-hr-db.ts');
    expect(db).toMatch(/WHERE e\.TenantId = @tenantId\s*`;/);
    expect(db).toMatch(/WHERE EmpID = @empID AND TenantId = @tenantId/);
  });
});

describe('DRVO-016 no CUT branch codes in HR server code', () => {
  const POLICY = 'src/lib/hr/legacyHrBranchPolicy.ts';

  it("no 'GLEEM' / 'CAMP_CAESAR' literals outside the legacy HR branch policy", () => {
    const offenders = OWNED_FILES.filter(
      (f) => f !== POLICY && /['"`]\s*(?:GLEEM|CAMP_CAESAR)\s*['"`]|N'(?:GLEEM|CAMP_CAESAR)'/.test(read(f)),
    );
    expect(offenders).toEqual([]);
  });

  it('HR UI derives branch tabs from the tenant branch list', () => {
    for (const f of [
      'src/components/hr/DailyPayrollPanel.tsx',
      'src/components/hr/AttendancePanel.tsx',
      'src/components/hr/EmployeeLedgerPanel.tsx',
      'src/components/hr/EmployeeMonthlySheetPanel.tsx',
      'src/components/hr/EmployeeMonthlyReportPanel.tsx',
      'src/app/manager/closing/page.tsx',
    ]) {
      expect(read(f), f).not.toMatch(/['"]\s*(?:GLEEM|CAMP_CAESAR)\s*['"]/);
    }
  });

  it('EMP_LEDGER_TABLE_BRANCH_CODES is gone (ledger columns come from tenant branches)', () => {
    expect(read('src/lib/types/employee-ledger.ts')).not.toMatch(/EMP_LEDGER_TABLE_BRANCH_CODES/);
  });
});

describe('DRVO-016 one-off ops code removed', () => {
  it('Youssef / Gleem August fill files are deleted', () => {
    for (const f of [
      'src/lib/hr/opsFillYoussefMohamedGleemAugust.ts',
      'src/app/api/dev/youssef-mohamed-fill/route.ts',
      'scripts/_fill-youssef-mohamed-gleem-aug.ts',
    ]) {
      expect(fs.existsSync(path.join(ROOT, f)), f).toBe(false);
    }
  });

  it('nothing references them', () => {
    const all = [...walk('src'), ...walk('scripts')];
    expect(all.filter((f) => /opsFillYoussef|youssef-mohamed-fill|fillYoussefMohamed/i.test(read(f)))).toEqual([]);
  });
});
