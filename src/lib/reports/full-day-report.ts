import 'server-only';

import { getPool, sql } from '@/lib/db';
import { roundMoney } from '@/lib/reportMonthUtils';
import { getArabicDayName } from '@/lib/reports/reportFormatters';
import { resolveEmployeeWhatsAppPhone } from '@/lib/integrations/whatsapp/payload-builders';
import { getEmployeeLedgerSummary } from '@/lib/services/employeeLedgerService';
import type {
  FullDayEmployeeAccountRow,
  FullDayEmployeeRow,
  FullDayGroupedMoneyLine,
  FullDayMoneyLine,
  FullDayReport,
} from '@/lib/reports/full-day-report.types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeSqlDate(val: unknown): string {
  if (!val) return '';
  if (typeof val === 'string') return val.slice(0, 10);
  if (val instanceof Date) {
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, '0');
    const d = String(val.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(val).slice(0, 10);
}

function isMissingTableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /Invalid object name/i.test(message);
}

async function queryOrEmpty<T>(label: string, fn: () => Promise<{ recordset: T[] }>): Promise<T[]> {
  try {
    const result = await fn();
    return result.recordset ?? [];
  } catch (err) {
    if (isMissingTableError(err)) {
      console.warn(`[full-day-report] ${label} unavailable`);
      return [];
    }
    throw err;
  }
}

function formatWorkDateLabelAr(workDate: string): string {
  const dayName = getArabicDayName(workDate);
  const d = new Date(`${workDate}T12:00:00`);
  const pretty = d.toLocaleDateString('ar-EG', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Africa/Cairo',
  });
  return `${dayName} · ${pretty}`;
}

export async function resolveDefaultBusinessDate(): Promise<string> {
  const db = await getPool();
  try {
    const dayResult = await db.request().query(`
      SELECT TOP 1 NewDay FROM dbo.TblNewDay
      WHERE Status = 1
      ORDER BY ID DESC
    `);
    if (dayResult.recordset[0]?.NewDay) {
      return normalizeSqlDate(dayResult.recordset[0].NewDay);
    }
  } catch {
    /* fall through */
  }
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

export async function getFullDayReport(workDate: string): Promise<FullDayReport> {
  if (!DATE_RE.test(workDate)) {
    throw new Error('workDate يجب أن يكون بصيغة YYYY-MM-DD');
  }

  const db = await getPool();

  const [salesRows, incomeRows, expenseRows, payrollRows, targetRows] = await Promise.all([
    queryOrEmpty<{ invoiceCount: number; totalSales: number; customerCount: number }>(
      'sales',
      () =>
        db.request().input('d', sql.Date, workDate).query(`
          SELECT
            COUNT(*) AS invoiceCount,
            ISNULL(SUM(h.GrandTotal), 0) AS totalSales,
            COUNT(DISTINCT h.ClientID) AS customerCount
          FROM dbo.TblinvServHead h
          WHERE CAST(h.invDate AS DATE) = @d
            AND h.invType = N'مبيعات'
            AND ISNULL(h.isActive, N'no') = N'no'
        `),
    ),

    queryOrEmpty<{
      ID: number;
      Amount: number;
      CatName: string | null;
      PaymentMethod: string | null;
      Notes: string | null;
    }>('incomes', () =>
      db.request().input('d', sql.Date, workDate).query(`
        SELECT TOP 40
          cm.ID,
          ISNULL(cm.GrandTolal, 0) AS Amount,
          cat.CatName,
          pm.PaymentMethod,
          cm.Notes
        FROM dbo.TblCashMove cm
        LEFT JOIN dbo.TblExpINCat cat ON cat.ExpINID = cm.ExpINID
        LEFT JOIN dbo.TblPaymentMethods pm ON pm.PaymentID = cm.PaymentMethodID
        WHERE CAST(cm.invDate AS DATE) = @d
          AND cm.invType = N'ايرادات'
        ORDER BY cm.ID DESC
      `),
    ),

    queryOrEmpty<{
      ID: number;
      Amount: number;
      CatName: string | null;
      PaymentMethod: string | null;
      Notes: string | null;
    }>('expenses', () =>
      db.request().input('d', sql.Date, workDate).query(`
        SELECT TOP 40
          cm.ID,
          ISNULL(cm.GrandTolal, 0) AS Amount,
          cat.CatName,
          pm.PaymentMethod,
          cm.Notes
        FROM dbo.TblCashMove cm
        LEFT JOIN dbo.TblExpINCat cat ON cat.ExpINID = cm.ExpINID
        LEFT JOIN dbo.TblPaymentMethods pm ON pm.PaymentID = cm.PaymentMethodID
        WHERE CAST(cm.invDate AS DATE) = @d
          AND cm.invType = N'مصروفات'
          AND cm.inOut = N'out'
          AND NOT EXISTS (
            SELECT 1
            FROM dbo.TblExpCatEmpMap m
            WHERE m.ExpINID = cm.ExpINID
              AND m.IsActive = 1
              AND m.TxnKind = N'advance'
          )
        ORDER BY cm.ID DESC
      `),
    ),

    queryOrEmpty<{
      EmpID: number;
      EmpName: string;
      CheckInTime: string | null;
      CheckOutTime: string | null;
      ActualHours: number | null;
      AttendanceStatus: string | null;
      DailyWage: number;
      Status: string | null;
      WhatsApp: string | null;
      Mobile: string | null;
    }>('payroll', () =>
      db.request().input('d', sql.Date, workDate).query(`
        SELECT
          p.EmpID,
          e.EmpName,
          CASE WHEN a.CheckInTime  IS NOT NULL THEN LEFT(CONVERT(VARCHAR(8), a.CheckInTime,  108), 5) ELSE NULL END AS CheckInTime,
          CASE WHEN a.CheckOutTime IS NOT NULL THEN LEFT(CONVERT(VARCHAR(8), a.CheckOutTime, 108), 5) ELSE NULL END AS CheckOutTime,
          p.ActualHours,
          a.Status AS AttendanceStatus,
          ISNULL(p.DailyWage, 0) AS DailyWage,
          p.Status,
          e.WhatsApp,
          e.Mobile
        FROM dbo.TblEmpDailyPayroll p
        INNER JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
        LEFT JOIN dbo.TblEmpAttendance a
          ON a.EmpID = p.EmpID AND a.WorkDate = p.WorkDate
        WHERE p.WorkDate = @d
        ORDER BY e.EmpName
      `),
    ),

    queryOrEmpty<{
      EmpID: number;
      TargetAmount: number;
      NetSalesAfterDiscount: number;
    }>('targets', () =>
      db.request().input('d', sql.Date, workDate).query(`
        SELECT
          EmpID,
          ISNULL(TargetAmount, 0) AS TargetAmount,
          ISNULL(NetSalesAfterDiscount, 0) AS NetSalesAfterDiscount
        FROM dbo.TblEmpDailyTarget
        WHERE WorkDate = @d
      `),
    ),
  ]);

  const salesAgg = salesRows[0] ?? { invoiceCount: 0, totalSales: 0, customerCount: 0 };
  const salesTotal = roundMoney(Number(salesAgg.totalSales ?? 0));
  const invoiceCount = Number(salesAgg.invoiceCount ?? 0);
  const customerCount = Number(salesAgg.customerCount ?? 0);

  const incomeLines: FullDayMoneyLine[] = incomeRows.map((r) => ({
    id: Number(r.ID),
    label: r.CatName || 'إيراد',
    amount: roundMoney(Number(r.Amount ?? 0)),
    meta: [r.PaymentMethod, r.Notes].filter(Boolean).join(' · ') || null,
  }));
  let incomesTotalFull = roundMoney(incomeLines.reduce((s, l) => s + l.amount, 0));
  let incomesCount = incomeLines.length;
  try {
    const sumRes = await db.request().input('d', sql.Date, workDate).query(`
      SELECT ISNULL(SUM(GrandTolal), 0) AS Total, COUNT(*) AS Cnt
      FROM dbo.TblCashMove
      WHERE CAST(invDate AS DATE) = @d
        AND invType = N'ايرادات'
    `);
    incomesTotalFull = roundMoney(Number(sumRes.recordset[0]?.Total ?? incomesTotalFull));
    incomesCount = Number(sumRes.recordset[0]?.Cnt ?? incomesCount);
  } catch {
    /* keep */
  }

  const expenseLines: FullDayMoneyLine[] = expenseRows.map((r) => ({
    id: Number(r.ID),
    label: r.CatName || 'مصروف',
    amount: roundMoney(Number(r.Amount ?? 0)),
    meta: [r.PaymentMethod, r.Notes].filter(Boolean).join(' · ') || null,
  }));
  let expensesTotal = roundMoney(expenseLines.reduce((s, l) => s + l.amount, 0));
  let expensesCount = expenseLines.length;
  try {
    const sumRes = await db.request().input('d', sql.Date, workDate).query(`
      SELECT ISNULL(SUM(cm.GrandTolal), 0) AS Total, COUNT(*) AS Cnt
      FROM dbo.TblCashMove cm
      WHERE CAST(cm.invDate AS DATE) = @d
        AND cm.invType = N'مصروفات'
        AND cm.inOut = N'out'
        AND NOT EXISTS (
          SELECT 1
          FROM dbo.TblExpCatEmpMap m
          WHERE m.ExpINID = cm.ExpINID
            AND m.IsActive = 1
            AND m.TxnKind = N'advance'
        )
    `);
    expensesTotal = roundMoney(Number(sumRes.recordset[0]?.Total ?? expensesTotal));
    expensesCount = Number(sumRes.recordset[0]?.Cnt ?? expensesCount);
  } catch {
    /* keep */
  }

  const targetByEmp = new Map<number, { amount: number; sales: number }>();
  for (const t of targetRows) {
    targetByEmp.set(Number(t.EmpID), {
      amount: roundMoney(Number(t.TargetAmount ?? 0)),
      sales: roundMoney(Number(t.NetSalesAfterDiscount ?? 0)),
    });
  }

  const employees: FullDayEmployeeRow[] = payrollRows.map((r) => {
    const empId = Number(r.EmpID);
    const target = targetByEmp.get(empId);
    const baseWage = roundMoney(Number(r.DailyWage ?? 0));
    const targetAmount = target?.amount ?? 0;
    const phone = resolveEmployeeWhatsAppPhone(r.WhatsApp, r.Mobile);
    return {
      empId,
      empName: String(r.EmpName ?? ''),
      checkIn: r.CheckInTime ?? null,
      checkOut: r.CheckOutTime ?? null,
      actualHours: r.ActualHours != null ? Number(r.ActualHours) : null,
      attendanceStatus: r.AttendanceStatus ?? null,
      baseWage,
      targetAmount,
      targetSales: target ? target.sales : null,
      dayTotal: roundMoney(baseWage + targetAmount),
      payrollStatus: r.Status ?? null,
      hasPhone: !!phone,
    };
  });

  const missingTargetEmpIds = [...targetByEmp.keys()].filter(
    (id) => !employees.some((e) => e.empId === id),
  );
  if (missingTargetEmpIds.length > 0) {
    const req = db.request();
    const placeholders = missingTargetEmpIds.map((id, i) => {
      const name = `t${i}`;
      req.input(name, sql.Int, id);
      return `@${name}`;
    });
    const nameRows = await req.query(`
      SELECT EmpID, EmpName, WhatsApp, Mobile
      FROM dbo.TblEmp
      WHERE EmpID IN (${placeholders.join(',')})
    `);
    for (const emp of nameRows.recordset as Array<{
      EmpID: number;
      EmpName: string;
      WhatsApp: string | null;
      Mobile: string | null;
    }>) {
      const target = targetByEmp.get(Number(emp.EmpID));
      if (!target) continue;
      employees.push({
        empId: Number(emp.EmpID),
        empName: String(emp.EmpName ?? ''),
        checkIn: null,
        checkOut: null,
        actualHours: null,
        attendanceStatus: null,
        baseWage: 0,
        targetAmount: target.amount,
        targetSales: target.sales,
        dayTotal: target.amount,
        payrollStatus: null,
        hasPhone: !!resolveEmployeeWhatsAppPhone(emp.WhatsApp, emp.Mobile),
      });
    }
  }

  employees.sort((a, b) => a.empName.localeCompare(b.empName, 'ar'));

  const wageTotal = roundMoney(employees.reduce((s, e) => s + e.baseWage, 0));
  const targetTotal = roundMoney(employees.reduce((s, e) => s + e.targetAmount, 0));
  const staffCostTotal = roundMoney(wageTotal + targetTotal);
  const presentCount = employees.filter((e) => !!e.checkIn).length;

  const totalIn = roundMoney(salesTotal + incomesTotalFull);
  const totalOut = roundMoney(expensesTotal + staffCostTotal);
  const net = roundMoney(totalIn - totalOut);

  const [operatingByCategoryRows, advancesByEmployeeRows] = await Promise.all([
    queryOrEmpty<{
      CatName: string | null;
      Total: number;
      Cnt: number;
    }>('expenses-by-category', () =>
      db.request().input('d', sql.Date, workDate).query(`
        SELECT
          ISNULL(cat.CatName, N'بدون تصنيف') AS CatName,
          ISNULL(SUM(cm.GrandTolal), 0) AS Total,
          COUNT(*) AS Cnt
        FROM dbo.TblCashMove cm
        LEFT JOIN dbo.TblExpINCat cat ON cat.ExpINID = cm.ExpINID
        WHERE CAST(cm.invDate AS DATE) = @d
          AND cm.invType = N'مصروفات'
          AND cm.inOut = N'out'
          AND NOT EXISTS (
            SELECT 1
            FROM dbo.TblExpCatEmpMap m
            WHERE m.ExpINID = cm.ExpINID
              AND m.IsActive = 1
              AND m.TxnKind = N'advance'
          )
        GROUP BY ISNULL(cat.CatName, N'بدون تصنيف')
        ORDER BY SUM(cm.GrandTolal) DESC
      `),
    ),

    queryOrEmpty<{
      EmpID: number;
      EmpName: string;
      Total: number;
      Cnt: number;
    }>('advances-by-employee', () =>
      db.request().input('d', sql.Date, workDate).query(`
        SELECT
          mapped.EmpID,
          e.EmpName,
          ISNULL(SUM(cm.GrandTolal), 0) AS Total,
          COUNT(*) AS Cnt
        FROM dbo.TblCashMove cm
        CROSS APPLY (
          SELECT TOP 1 m.EmpID
          FROM dbo.TblExpCatEmpMap m
          WHERE m.ExpINID = cm.ExpINID
            AND m.IsActive = 1
            AND m.TxnKind = N'advance'
          ORDER BY m.ID DESC
        ) mapped
        INNER JOIN dbo.TblEmp e ON e.EmpID = mapped.EmpID
        WHERE CAST(cm.invDate AS DATE) = @d
          AND cm.invType = N'مصروفات'
          AND cm.inOut = N'out'
        GROUP BY mapped.EmpID, e.EmpName
        ORDER BY SUM(cm.GrandTolal) DESC
      `),
    ),
  ]);

  const operatingByCategory: FullDayGroupedMoneyLine[] = operatingByCategoryRows.map((r) => ({
    key: `cat:${r.CatName ?? 'none'}`,
    label: r.CatName || 'بدون تصنيف',
    amount: roundMoney(Number(r.Total ?? 0)),
    count: Number(r.Cnt ?? 0),
    meta: Number(r.Cnt ?? 0) > 1
      ? `${Number(r.Cnt)} \u062d\u0631\u0643\u0627\u062a`
      : '\u062d\u0631\u0643\u0629',
  }));

  const advancesByEmployee: FullDayGroupedMoneyLine[] = advancesByEmployeeRows.map((r) => {
    const count = Number(r.Cnt ?? 0);
    return {
      key: `emp:${r.EmpID}`,
      label: String(r.EmpName ?? 'موظف'),
      amount: roundMoney(Number(r.Total ?? 0)),
      count,
      meta: count > 1
        ? `${count} \u0633\u0644\u0641 \u0645\u062c\u0645\u0639\u0629`
        : '\u0633\u0644\u0641\u0629',
    };
  });

  const advancesTotal = roundMoney(
    advancesByEmployee.reduce((s, r) => s + r.amount, 0),
  );
  const treasuryOutTotal = roundMoney(expensesTotal + advancesTotal);
  const treasuryInTotal = totalIn;
  const treasuryNet = roundMoney(treasuryInTotal - treasuryOutTotal);

  const payrollMonth = workDate.slice(0, 7);
  const advancesTodayByEmp = new Map(
    advancesByEmployee.map((r) => {
      const empId = Number(String(r.key).replace(/^emp:/, ''));
      return [empId, r.amount] as const;
    }),
  );

  let ledgerByEmp = new Map<number, { empName: string; balance: number }>();
  try {
    const ledgerSummary = await getEmployeeLedgerSummary(payrollMonth);
    ledgerByEmp = new Map(
      ledgerSummary.employees.map((e) => [
        e.empId,
        { empName: e.empName, balance: roundMoney(e.balance) },
      ]),
    );
  } catch (err) {
    console.warn('[full-day-report] ledger summary unavailable', err);
  }

  const accountEmpIds = new Set<number>([
    ...employees.map((e) => e.empId),
    ...ledgerByEmp.keys(),
    ...advancesTodayByEmp.keys(),
  ]);

  const accountRows: FullDayEmployeeAccountRow[] = [...accountEmpIds].map((empId) => {
    const dayEmp = employees.find((e) => e.empId === empId);
    const ledger = ledgerByEmp.get(empId);
    const dayBase = dayEmp?.baseWage ?? 0;
    const dayTarget = dayEmp?.targetAmount ?? 0;
    return {
      empId,
      empName: dayEmp?.empName || ledger?.empName || `موظف #${empId}`,
      dayBase,
      dayTarget,
      dayTotal: roundMoney(dayBase + dayTarget),
      advancesToday: advancesTodayByEmp.get(empId) ?? 0,
      ledgerBalance: ledger?.balance ?? 0,
    };
  });

  accountRows.sort((a, b) => {
    const byBalance = Math.abs(b.ledgerBalance) - Math.abs(a.ledgerBalance);
    if (byBalance !== 0) return byBalance;
    return a.empName.localeCompare(b.empName, 'ar');
  });

  // Keep employees with activity or non-zero balance
  const visibleAccounts = accountRows.filter(
    (r) =>
      r.dayTotal > 0 ||
      r.advancesToday > 0 ||
      Math.abs(r.ledgerBalance) > 0.009 ||
      employees.some((e) => e.empId === r.empId),
  );

  return {
    workDate,
    workDateLabelAr: formatWorkDateLabelAr(workDate),
    timezone: 'Africa/Cairo',
    sales: {
      total: salesTotal,
      invoiceCount,
      customerCount,
      averageInvoice: invoiceCount > 0 ? roundMoney(salesTotal / invoiceCount) : 0,
    },
    incomes: {
      total: incomesTotalFull,
      count: incomesCount,
      lines: incomeLines,
    },
    expenses: {
      total: expensesTotal,
      count: expensesCount,
      lines: expenseLines,
    },
    payroll: {
      wageTotal,
      targetTotal,
      staffCostTotal,
      employeeCount: employees.length,
      presentCount,
      employees,
    },
    profit: {
      totalIn,
      totalOut,
      net,
    },
    ownerDay: {
      sales: salesTotal,
      incomes: incomesTotalFull,
      operatingExpenses: expensesTotal,
      staffBase: wageTotal,
      staffTarget: targetTotal,
      staffCost: staffCostTotal,
      totalIn,
      totalOut,
      net,
    },
    employeeAccounts: {
      payrollMonth,
      totalDayCost: roundMoney(visibleAccounts.reduce((s, r) => s + r.dayTotal, 0)),
      totalAdvancesToday: roundMoney(
        visibleAccounts.reduce((s, r) => s + r.advancesToday, 0),
      ),
      totalLedgerBalance: roundMoney(
        visibleAccounts.reduce((s, r) => s + r.ledgerBalance, 0),
      ),
      rows: visibleAccounts,
    },
    treasury: {
      inflows: {
        sales: salesTotal,
        incomes: incomesTotalFull,
        total: treasuryInTotal,
      },
      outflows: {
        operatingTotal: expensesTotal,
        advancesTotal,
        total: treasuryOutTotal,
        operatingByCategory,
        advancesByEmployee,
      },
      net: treasuryNet,
    },
    whatsapp: {
      readyToSend: employees.filter((e) => e.hasPhone && (e.checkIn || e.baseWage > 0 || e.targetAmount > 0)).length,
      missingPhone: employees.filter((e) => !e.hasPhone && (e.checkIn || e.baseWage > 0 || e.targetAmount > 0)).length,
    },
  };
}
