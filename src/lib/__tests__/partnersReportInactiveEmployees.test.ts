/**
 * Partners employee accounts must keep inactive staff who still have ledger
 * activity for the selected month (fed by getEmployeeLedgerSummary).
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/services/employeeServicesReportService', () => ({
  getEmployeeActualInvoiceRevenueByEmployee: vi.fn(),
  getEmployeeJobById: vi.fn(),
  getEmployeeNamesById: vi.fn(),
  getEmployeeServicesRevenue: vi.fn(),
  getEmployeeServicesRevenueByEmployee: vi.fn(),
  isBarberOrServiceWorker: (job: string) => /حلاق|خدمة/i.test(job),
}));

vi.mock('@/lib/services/monthlyExpensesReportService', () => ({
  getMonthlyEmployeeAdvances: vi.fn(),
  getMonthlyExpensesByCategory: vi.fn(),
}));

vi.mock('@/lib/services/employeeLedgerService', () => ({
  getEmployeeLedgerSummary: vi.fn(),
}));

vi.mock('@/lib/reports/partnersEmployeeOverridesStore', () => ({
  loadPartnersEmployeeOverridesForBranch: vi.fn(),
}));

vi.mock('@/lib/accounting/financialReportFlags', () => ({
  isFinancialReportClassificationEnabled: vi.fn(() => false),
}));

vi.mock('@/lib/accounting/financialReportClassificationService', () => ({
  maybeBuildClassificationPayload: vi.fn(),
}));

vi.mock('@/lib/branch/repository', () => ({
  getBranchById: vi.fn(),
}));

vi.mock('@/lib/branch/partnerShares', () => ({
  getEffectiveBranchPartnerShares: vi.fn(),
  toPartnerPercentageList: vi.fn(),
}));

vi.mock('@/lib/services/storeIncomeService', () => ({
  sumStoreOtherBusinessIncomeForMonth: vi.fn(),
}));

vi.mock('@/platform/masterData/tenantScope', () => ({
  resolveLegacyBranchTenantId: vi.fn(),
}));

import { mapPartnersEmployeeRows } from '@/lib/services/partnersReportService';

const root = path.join(__dirname, '..', '..', '..');

describe('partners historical inactive employees', () => {
  it('partners report builds employee accounts from ledger summary (shared inactive fix)', () => {
    const svc = fs.readFileSync(
      path.join(root, 'src/lib/services/partnersReportService.ts'),
      'utf8',
    );
    expect(svc).toContain('getEmployeeLedgerSummary');
    expect(svc).toContain('ledgerActiveEmployeeIds');
    expect(svc).toContain('ledgerSummaryEmployees');
  });

  it('includes ledger-only employees with salary/target even without invoice revenue', () => {
    const { employeeSummary } = mapPartnersEmployeeRows({
      year: 2026,
      month: 10,
      actualRevenueByEmployee: [],
      advanceRows: [],
      employeeJobs: new Map([[42, 'حلاق']]),
      employeeNames: new Map([[42, 'محمود']]),
      ledgerSummaryEmployees: [
        {
          empId: 42,
          empName: 'محمود',
          salaryCredits: 5000,
          targetCredits: 1200,
          advanceDebits: 0,
          payoutDebits: 0,
          fundingCredits: 0,
        },
      ],
      partnerOverrides: {},
    });

    expect(employeeSummary).toHaveLength(1);
    expect(employeeSummary[0]).toMatchObject({
      employeeId: 42,
      employeeName: 'محمود',
      salaryAndTarget: 6200,
      ledgerSalary: 5000,
      ledgerTarget: 1200,
    });
  });
});
