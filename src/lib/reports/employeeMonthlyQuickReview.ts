import 'server-only';

import { getPool, sql } from '@/lib/db';
import { parseMtdTargetSnapshot } from '@/lib/payroll/employee-target/mtd-target-snapshot';
import { roundMoney } from '@/lib/reportMonthUtils';
import type {
  EmployeeMonthlyQuickReviewResponse,
  EmployeeMonthlyQuickReviewRow,
} from '@/lib/reports/employeeMonthlyQuickReview.types';

export type {
  EmployeeMonthlyQuickReviewResponse,
  EmployeeMonthlyQuickReviewRow,
} from '@/lib/reports/employeeMonthlyQuickReview.types';

function cairoTodayYmd(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function lastDayOfMonth(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month, 0));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Current Cairo day if inside the month; otherwise the month's last day. */
export function resolveQuickReviewWorkDate(year: number, month: number): string {
  const today = cairoTodayYmd();
  const [ty, tm] = today.split('-').map(Number);
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthEnd = lastDayOfMonth(year, month);

  if (ty === year && tm === month) return today;
  if (today < monthStart) return monthStart;
  return monthEnd;
}

function timeOrNull(value: unknown): string | null {
  if (value == null || value === '') return null;
  return String(value).slice(0, 5);
}

function moneyOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return roundMoney(n);
}

function ymd(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '').slice(0, 10);
}

/**
 * Day-by-day abbreviated review for every employee day in the month
 * (through asOfDate): check-in, check-out, branch, daily wage, target MTD.
 */
export async function getEmployeeMonthlyQuickReview(params: {
  year: number;
  month: number;
  branchIds: number[];
}): Promise<EmployeeMonthlyQuickReviewResponse> {
  const { year, month, branchIds } = params;
  const asOfDate = resolveQuickReviewWorkDate(year, month);
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;

  if (branchIds.length === 0) {
    return { asOfDate, workDate: asOfDate, year, month, rows: [] };
  }

  const db = await getPool();
  const req = db
    .request()
    .input('monthStart', sql.Date, monthStart)
    .input('asOfDate', sql.Date, asOfDate);

  const idParams: string[] = [];
  branchIds.forEach((id, i) => {
    const name = `b${i}`;
    req.input(name, sql.Int, id);
    idParams.push(`@${name}`);
  });
  const inList = idParams.join(', ');

  const result = await req.query(`
    ;WITH DayKeys AS (
      SELECT EmpID, WorkDate FROM dbo.TblEmpAttendance
      WHERE WorkDate >= @monthStart AND WorkDate <= @asOfDate AND BranchID IN (${inList})
      UNION
      SELECT EmpID, WorkDate FROM dbo.TblEmpDailyPayroll
      WHERE WorkDate >= @monthStart AND WorkDate <= @asOfDate AND BranchID IN (${inList})
      UNION
      SELECT EmpID, WorkDate FROM dbo.TblEmpDailyTarget
      WHERE WorkDate >= @monthStart AND WorkDate <= @asOfDate AND BranchID IN (${inList})
    ),
    DayAtt AS (
      SELECT
        a.EmpID,
        a.WorkDate,
        a.BranchID,
        CONVERT(VARCHAR(5), a.CheckInTime, 108) AS CheckInTime,
        CONVERT(VARCHAR(5), a.CheckOutTime, 108) AS CheckOutTime,
        ROW_NUMBER() OVER (
          PARTITION BY a.EmpID, a.WorkDate
          ORDER BY
            CASE WHEN a.CheckInTime IS NOT NULL THEN 0 ELSE 1 END,
            a.BranchID
        ) AS rn
      FROM dbo.TblEmpAttendance a
      WHERE a.WorkDate >= @monthStart
        AND a.WorkDate <= @asOfDate
        AND a.BranchID IN (${inList})
    ),
    DayPay AS (
      SELECT
        p.EmpID,
        p.WorkDate,
        p.BranchID,
        p.DailyWage,
        ROW_NUMBER() OVER (
          PARTITION BY p.EmpID, p.WorkDate
          ORDER BY
            CASE WHEN p.DailyWage IS NOT NULL AND p.DailyWage > 0 THEN 0 ELSE 1 END,
            p.BranchID
        ) AS rn
      FROM dbo.TblEmpDailyPayroll p
      WHERE p.WorkDate >= @monthStart
        AND p.WorkDate <= @asOfDate
        AND p.BranchID IN (${inList})
    ),
    DayTgt AS (
      SELECT
        t.EmpID,
        t.WorkDate,
        t.BranchID,
        t.TargetAmount,
        t.CalculationBreakdownJson,
        ROW_NUMBER() OVER (
          PARTITION BY t.EmpID, t.WorkDate
          ORDER BY t.BranchID
        ) AS rn
      FROM dbo.TblEmpDailyTarget t
      WHERE t.WorkDate >= @monthStart
        AND t.WorkDate <= @asOfDate
        AND t.BranchID IN (${inList})
    )
    SELECT
      e.EmpID,
      ISNULL(e.EmpName, N'غير محدد') AS EmpName,
      CASE WHEN ISNULL(e.isActive, 1) = 1 THEN 1 ELSE 0 END AS IsActiveFlag,
      CONVERT(VARCHAR(10), k.WorkDate, 23) AS WorkDate,
      att.CheckInTime,
      att.CheckOutTime,
      COALESCE(att.BranchID, pay.BranchID, tgt.BranchID) AS BranchID,
      b.BranchCode,
      b.BranchName,
      pay.DailyWage,
      tgt.TargetAmount AS DayTargetAmount,
      tgt.CalculationBreakdownJson
    FROM DayKeys k
    INNER JOIN dbo.TblEmp e ON e.EmpID = k.EmpID
    LEFT JOIN DayAtt att ON att.EmpID = k.EmpID AND att.WorkDate = k.WorkDate AND att.rn = 1
    LEFT JOIN DayPay pay ON pay.EmpID = k.EmpID AND pay.WorkDate = k.WorkDate AND pay.rn = 1
    LEFT JOIN DayTgt tgt ON tgt.EmpID = k.EmpID AND tgt.WorkDate = k.WorkDate AND tgt.rn = 1
    LEFT JOIN dbo.TblBranch b
      ON b.BranchID = COALESCE(att.BranchID, pay.BranchID, tgt.BranchID)
    ORDER BY
      CASE WHEN ISNULL(e.isActive, 1) = 1 THEN 0 ELSE 1 END,
      e.EmpName,
      k.WorkDate
  `);

  type Raw = Record<string, unknown>;
  const rawRows = result.recordset as Raw[];

  // Running MTD target per employee when snapshot is missing.
  const running = new Map<number, number>();
  const rows: EmployeeMonthlyQuickReviewRow[] = rawRows.map((row) => {
    const employeeId = Number(row.EmpID);
    const workDate = ymd(row.WorkDate);
    const dayTarget = moneyOrNull(row.DayTargetAmount);
    const snap = parseMtdTargetSnapshot(
      row.CalculationBreakdownJson == null ? null : String(row.CalculationBreakdownJson),
    );

    let targetMtd = snap.mtdTargetAmount != null ? roundMoney(snap.mtdTargetAmount) : null;
    if (targetMtd == null) {
      const prev = running.get(employeeId) ?? 0;
      const next = roundMoney(prev + (dayTarget ?? 0));
      running.set(employeeId, next);
      targetMtd = dayTarget == null && prev === 0 ? null : next;
    } else {
      running.set(employeeId, targetMtd);
    }

    return {
      employeeId,
      employeeName: String(row.EmpName ?? 'غير محدد'),
      isActive: Number(row.IsActiveFlag) === 1,
      workDate,
      checkIn: timeOrNull(row.CheckInTime),
      checkOut: timeOrNull(row.CheckOutTime),
      branchId: row.BranchID == null ? null : Number(row.BranchID),
      branchCode: row.BranchCode == null ? null : String(row.BranchCode),
      branchName: row.BranchName == null ? null : String(row.BranchName),
      dailyWage: moneyOrNull(row.DailyWage),
      targetDay: dayTarget,
      targetMtd,
    };
  });

  return {
    asOfDate,
    workDate: asOfDate,
    year,
    month,
    rows,
  };
}
