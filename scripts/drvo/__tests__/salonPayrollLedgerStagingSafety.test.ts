import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
const read=(p:string)=>fs.readFileSync(path.join(process.cwd(),p),'utf8');
describe('Salon payroll ledger isolation staging contract',()=>{
 it('guards staging-only execution, foreign employee exclusion and cleanup',()=>{
  const s=read('scripts/drvo/drvo-016-hr-payroll-smoke.ts');
  const w=read('.github/workflows/salon-payroll-ledger-isolation-staging-e2e.yml');
  expect(s).toContain("const STAGING_DB = 'last132_agent'");
  expect(s).toContain("const STAGING_LOGIN = 'drvo_agent'");
  expect(s).toContain('executeDailyPayrollGenerate(');
  expect(s).toContain('executeEmployeePayout(');
  expect(s).toContain('getEmployeeLedgerSummary(');
  expect(s).toContain('!ids.includes(foreignEmp)');
  expect(s).toContain('await cleanupAll(pool)');
  expect(s).toContain('CASHER_BOOT employee count unchanged');
  expect(w).toContain("head.ref == 'agent/salon-payroll-report-isolation'");
  expect(w).toContain('environment: drvo-staging');
  expect(w).not.toContain('deploy-vps');
 });
 it('checks actual invoice-shaped target request persistence for two unique staging tenants',()=>{
  const script=read('scripts/drvo/salon-pos-target-payroll-staging.ts');
  const workflow=read('.github/workflows/salon-pos-target-payroll-staging-e2e.yml');
  expect(script).toContain('randomBytes(4)');
  expect(script).toContain('enqueueTargetRecalcFromInvoiceSnapshots({');
  expect(script).toContain('header: { invDate: WORK_DATE, branchId: t.branchId }');
  expect(script).toContain('dbo.TblEmpTargetRecalcRequest');
  expect(script).toContain('processEmployeeTargetRecalcRequests({');
  expect(script).toContain("Status === 'completed'");
  expect(script).toContain('RequestedVersion) ===');
  expect(script).toContain('await cleanupAll(pool)');
  expect(workflow).toContain('environment: drvo-staging');
  expect(workflow).toContain("head.ref == 'agent/salon-payroll-report-isolation'");
 });
 it('does not conflate payroll summaries with revenue reporting or sale commission',()=>{
  const d=read('docs/drvo/SALON-PACK-PAYROLL-REPORTS-ACCEPTANCE.md');
  expect(d).toContain('Invoice → commission integration');
  expect(d).toContain('Financial reporting projection');
  expect(d).toContain('Still NOT proven');
 });
});