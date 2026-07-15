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
    expenses: { total: 1555, count: 5, lines: [] },
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
          dayTotal: 794.18,
          advancesToday: 550,
          ledgerBalance: -11462.19,
        },
        {
          empId: 2,
          empName: 'طارق',
          dayBase: 0,
          dayTarget: 0,
          dayTotal: 0,
          advancesToday: 10,
          ledgerBalance: 9045,
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
    whatsapp: { readyToSend: 2, missingPhone: 0 },
  };
}

describe('composeOwnerDailyWhatsAppMessage', () => {
  it('matches owner digest sections', () => {
    const msg = composeOwnerDailyWhatsAppMessage(sampleReport());
    expect(msg).toContain('تقرير المالك اليومي');
    expect(msg).toContain('نتيجة التشغيل');
    expect(msg).toContain('حركة الخزنة الفعلية');
    expect(msg).toContain('تفاصيل مصروفات التشغيل');
    expect(msg).toContain('سلف الموظفين');
    expect(msg).toContain('حسابات الموظفين');
    expect(msg).toContain('مواعيد الحضور والانصراف');
    expect(msg).toContain('صافي ربح اليوم: 2,771.89 ج.م');
    expect(msg).toContain('كهرباء');
    expect(msg).toContain('حركتان');
    expect(msg).toContain('زياد');
    expect(msg).toContain('حضور');
    expect(msg).toContain('انصراف');
    expect(msg).toContain('بدون حضور');
    expect(msg).toContain('سلفتان');
    expect(msg).toContain('ملخص اليوم');
  });
});
