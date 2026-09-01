import { describe, expect, it } from 'vitest';
import { composeOwnerDailyWhatsAppMessage } from '@/lib/hr/owner-daily-whatsapp-message';
import type { FullDayReport } from '@/lib/reports/full-day-report.types';

function sampleReport(): FullDayReport {
  return {
    workDate: '2026-07-14',
    workDateLabelAr: 'الثلاثاء · 14 يوليو 2026',
    timezone: 'Africa/Cairo',
    sales: { total: 7060, invoiceCount: 10, customerCount: 8, averageInvoice: 706 },
    incomes: { total: 100, count: 1, lines: [] },
    expenses: {
      total: 1555,
      count: 5,
      lines: [
        { id: 101, label: 'كهرباء', amount: 1000, meta: 'كاش · فاتورة يوليو' },
        { id: 102, label: 'كهرباء', amount: 200, meta: 'كاش' },
        { id: 103, label: 'بوفيه', amount: 355, meta: 'شاي وسكر' },
      ],
    },
    payroll: {
      wageTotal: 1850.51,
      targetTotal: 982.6,
      staffCostTotal: 2833.11,
      employeeCount: 2,
      presentCount: 2,
      employees: [
        {
          empId: 1,
          empName: 'زياد',
          checkIn: '10:05',
          checkOut: '20:10',
          actualHours: 9.5,
          attendanceStatus: 'present',
          baseWage: 368.18,
          targetAmount: 426,
          targetSales: 5000,
          mtdSales: 45000,
          mtdTargetAmount: 1500,
          targetBreakdown: [
            {
              from: 40000,
              to: 50000,
              eligibleAmount: 5000,
              ratePercent: 30,
              targetAmount: 1500,
            },
          ],
          dayTotal: 794.18,
          payrollStatus: 'approved',
          hasPhone: true,
        },
        {
          empId: 2,
          empName: 'طارق',
          checkIn: null,
          checkOut: null,
          actualHours: null,
          attendanceStatus: null,
          baseWage: 0,
          targetAmount: 0,
          targetSales: null,
          mtdSales: null,
          mtdTargetAmount: null,
          targetBreakdown: null,
          dayTotal: 0,
          payrollStatus: null,
          hasPhone: true,
        },
      ],
    },
    profit: { totalIn: 7160, totalOut: 4388.11, net: 2771.89 },
    ownerDay: {
      sales: 7060,
      incomes: 100,
      operatingExpenses: 1555,
      staffBase: 1850.51,
      staffTarget: 982.6,
      staffCost: 2833.11,
      totalIn: 7160,
      totalOut: 4388.11,
      net: 2771.89,
    },
    employeeAccounts: {
      payrollMonth: '2026-07',
      totalDayCost: 2833.11,
      totalAdvancesToday: 1895,
      totalLedgerBalance: 9774.79,
      rows: [
        {
          empId: 1,
          empName: 'زياد',
          dayBase: 368.18,
          dayTarget: 426,
          mtdTargetAmount: 1500,
          mtdSales: 45000,
          targetBreakdown: [
            {
              from: 40000,
              to: 50000,
              eligibleAmount: 5000,
              ratePercent: 30,
              targetAmount: 1500,
            },
          ],
          dayTotal: 794.18,
          advancesToday: 550,
          ledgerBalance: -11462.19,
          payType: null,
          monthlySalary: null,
          monthlySalaryLedger: null,
        },
        {
          empId: 2,
          empName: 'طارق',
          dayBase: 0,
          dayTarget: 0,
          mtdTargetAmount: null,
          mtdSales: null,
          targetBreakdown: null,
          dayTotal: 0,
          advancesToday: 10,
          ledgerBalance: 9045,
          payType: null,
          monthlySalary: null,
          monthlySalaryLedger: null,
        },
      ],
    },
    treasury: {
      inflows: { sales: 7060, incomes: 100, total: 7160 },
      outflows: {
        operatingTotal: 1555,
        advancesTotal: 1895,
        total: 3450,
        operatingByCategory: [
          { key: 'cat:كهرباء', label: 'كهرباء', amount: 1200, count: 2 },
          { key: 'cat:بوفيه', label: 'بوفيه', amount: 200, count: 4 },
        ],
        advancesByEmployee: [
          { key: 'emp:1', label: 'زياد', amount: 550, count: 2 },
          { key: 'emp:2', label: 'طارق', amount: 10, count: 1 },
        ],
      },
      net: 3710,
    },
    paymentMix: {
      total: 7160,
      salesTotal: 7060,
      incomesTotal: 100,
      rows: [
        { method: 'كاش', salesTotal: 5060, incomesTotal: 100, total: 5160, count: 7, percent: 72.1 },
        { method: 'فيزا', salesTotal: 2000, incomesTotal: 0, total: 2000, count: 3, percent: 27.9 },
      ],
    },
    monthToDate: {
      month: '2026-07',
      fromDate: '2026-07-01',
      toDate: '2026-07-14',
      sales: 90000,
      incomes: 1500,
      operatingExpenses: 20000,
      staffBase: 25000,
      staffTarget: 12000,
      advances: 8000,
      netProfit: 34500,
      treasuryNet: 63500,
    },
    whatsapp: { readyToSend: 2, missingPhone: 0 },
  };
}

function campChizarNegativeTreasuryReport(): FullDayReport {
  const base = sampleReport();
  return {
    ...base,
    workDate: '2026-08-30',
    workDateLabelAr: 'الأحد · 30 أغسطس 2026',
    ownerDay: {
      sales: 140,
      incomes: 0,
      operatingExpenses: 0,
      staffBase: 0,
      staffTarget: 0,
      staffCost: 0,
      totalIn: 140,
      totalOut: 0,
      net: 140,
    },
    treasury: {
      inflows: { sales: 140, incomes: 0, total: 140 },
      outflows: {
        operatingTotal: 0,
        advancesTotal: 485,
        total: 485,
        operatingByCategory: [],
        advancesByEmployee: [
          { key: 'emp:1', label: 'احمد', amount: 250, count: 2 },
          { key: 'emp:2', label: 'عمر', amount: 165, count: 4 },
        ],
      },
      net: -345,
    },
    employeeAccounts: {
      payrollMonth: '2026-08',
      totalDayCost: 0,
      totalAdvancesToday: 485,
      totalLedgerBalance: 6556.71,
      rows: [],
    },
    paymentMix: {
      total: 140,
      salesTotal: 140,
      incomesTotal: 0,
      rows: [
        { method: 'كاش', salesTotal: 140, incomesTotal: 0, total: 140, count: 1, percent: 100 },
      ],
    },
    monthToDate: {
      month: '2026-08',
      fromDate: '2026-08-01',
      toDate: '2026-08-30',
      sales: 0,
      incomes: 0,
      operatingExpenses: 0,
      staffBase: 0,
      staffTarget: 0,
      advances: 485,
      netProfit: 6867.51,
      treasuryNet: 211,
    },
  };
}

describe('composeOwnerDailyWhatsAppMessage', () => {
  it('matches owner digest sections', () => {
    const msg = composeOwnerDailyWhatsAppMessage(sampleReport());
    expect(msg).toContain('تقفيل اليوم');
    expect(msg).toContain('الربحية (تشغيل)');
    expect(msg).toContain('طرق الدفع');
    expect(msg).toContain('كاش');
    expect(msg).toContain('فيزا');
    expect(msg).toContain('إجمالي الوارد');
    expect(msg).toContain('الخزنة (فلوس فعلية)');
    expect(msg).toContain('مصروفات التشغيل');
    expect(msg).toContain('حسب التصنيف');
    expect(msg).toContain('البنود بالتفصيل');
    expect(msg).toContain('فاتورة يوليو');
    expect(msg).toContain('شاي وسكر');
    expect(msg).toContain('سلف الموظفين');
    expect(msg).toContain('الموظفين');
    expect(msg).toContain('الحضور');
    expect(msg).toContain('صافي ربح التشغيل: *2,771.89 ج.م*');
    expect(msg).toContain('كهرباء');
    expect(msg).toContain('حركتان');
    expect(msg).toContain('زياد');
    expect(msg).toContain('حضور');
    expect(msg).toContain('بدون حضور');
    expect(msg).toContain('سلفتان');
    expect(msg).toContain('ملخص سريع');
    expect(msg).toContain('تراكمي الشهر');
    expect(msg).toContain('ربح التشغيل حتى اليوم: *34,500.00 ج.م*');
    expect(msg).toContain('سيولة الخزنة حتى اليوم: *63,500.00 ج.م*');
    expect(msg).toContain('حساب التارجت');
    expect(msg).not.toContain('تارجت الموظفين حتى الآن');
  });

  it('puts branch name in the title when provided', () => {
    const msg = composeOwnerDailyWhatsAppMessage(sampleReport(), {
      branchName: 'كامب شيزار',
    });
    expect(msg).toContain('تقفيل اليوم — كامب شيزار');
    expect(msg).toContain('الثلاثاء · 14 يوليو 2026');
  });

  it('shows negative treasury net when outflows exceed inflows', () => {
    const msg = composeOwnerDailyWhatsAppMessage(campChizarNegativeTreasuryReport(), {
      branchName: 'كامب شيزار',
    });
    expect(msg).toContain('صافي الخزنة اليوم: *−345.00 ج.م*');
    expect(msg).toContain('صافي الخزنة: *−345.00 ج.م*');
    expect(msg).not.toContain('صافي الخزنة اليوم: *345.00 ج.م*');
  });
});
