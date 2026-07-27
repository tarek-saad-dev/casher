/**
 * Phase 1S — Camp Caesar launch roster: list candidates + coverage dashboard.
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import { BranchDomainError } from './types';
import { commitEmployeeBranchAssignment } from './employeeAssignmentCommit';
import type { CommitEmployeeBranchAssignmentInput } from './employeeAssignmentCommit';

const GLEEM_BRANCH_ID = 1;
const DAY_NAMES_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export type LaunchRosterDaySummary = {
  dayOfWeek: number;
  dayNameAr: string;
  isWorking: boolean;
  startTime: string | null;
  endTime: string | null;
};

export type LaunchRosterEmployee = {
  empId: number;
  empName: string;
  job: string | null;
  gleemDays: LaunchRosterDaySummary[];
  gleemHoursSummary: string;
  gleemServicesSummary: string;
  gleemPayrollSummary: string;
  gleemTargetSummary: string;
  campCaesarAssigned: boolean;
  campCaesarAssignmentId: number | null;
  campCaesarCanReceiveBookings: boolean;
  campCaesarCanOperate: boolean;
  campCaesarPayrollSummary: string | null;
  campCaesarTargetSummary: string | null;
  campCaesarScheduleSummary: string | null;
  campCaesarServicesSummary: string | null;
  readinessStatus: 'ready' | 'partial' | 'not_assigned' | 'blocked';
  readinessNotes: string[];
};

export type LaunchCoverageRow = {
  empId: number;
  empName: string;
  assignment: string;
  schedule: string;
  services: string;
  payroll: string;
  target: string;
  bookingEligibility: string;
  finalStatus: 'ready' | 'blocked';
  blockers: string[];
};

function hhmm(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    const h = String(v.getUTCHours()).padStart(2, '0');
    const m = String(v.getUTCMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
  const s = String(v);
  const m = s.match(/(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : s.slice(0, 5);
}

function summarizeDays(days: LaunchRosterDaySummary[]): string {
  const working = days.filter((d) => d.isWorking);
  if (!working.length) return 'لا أيام عمل';
  return working
    .map((d) => `${d.dayNameAr} ${d.startTime ?? ''}-${d.endTime ?? ''}`.trim())
    .join(' · ');
}

export async function listLaunchRosterEmployees(branchId: number): Promise<{
  branchId: number;
  gleemBranchId: number;
  employees: LaunchRosterEmployee[];
}> {
  const db = await getPool();
  const emps = await db.request().query(`
    SELECT e.EmpID, e.EmpName, e.Job
    FROM dbo.TblEmp e
    WHERE ISNULL(e.isActive, 1) = 1
      AND e.Job = N'حلاق'
      AND (e.EmpName IS NULL OR (
        e.EmpName NOT LIKE N'%[SMOKE%'
        AND e.EmpName NOT LIKE N'%[TEST%'
        AND e.EmpName NOT LIKE N'%[SMOKE 1S]%'
      ))
    ORDER BY e.EmpName
  `);

  const employees: LaunchRosterEmployee[] = [];
  for (const row of emps.recordset as Array<{ EmpID: number; EmpName: string; Job: string | null }>) {
    const empId = Number(row.EmpID);

    const gleemSched = await db
      .request()
      .input('empId', sql.Int, empId)
      .input('branchId', sql.Int, GLEEM_BRANCH_ID)
      .query(`
        SELECT DayOfWeek, IsWorking, StartTime, EndTime
        FROM dbo.TblEmpBranchWorkSchedule
        WHERE EmpID=@empId AND BranchID=@branchId AND IsActive=1
        ORDER BY DayOfWeek
      `);

    let gleemDays: LaunchRosterDaySummary[] = gleemSched.recordset.map(
      (d: { DayOfWeek: number; IsWorking: boolean; StartTime: unknown; EndTime: unknown }) => ({
        dayOfWeek: Number(d.DayOfWeek),
        dayNameAr: DAY_NAMES_AR[Number(d.DayOfWeek)] ?? String(d.DayOfWeek),
        isWorking: Boolean(d.IsWorking),
        startTime: hhmm(d.StartTime),
        endTime: hhmm(d.EndTime),
      }),
    );

    if (!gleemDays.length) {
      const legacy = await db.request().input('empId', sql.Int, empId).query(`
        SELECT DayOfWeek, IsWorkingDay AS IsWorking, StartTime, EndTime
        FROM dbo.TblEmpWorkSchedule
        WHERE EmpID=@empId
        ORDER BY DayOfWeek
      `);
      gleemDays = legacy.recordset.map(
        (d: { DayOfWeek: number; IsWorking: boolean; StartTime: unknown; EndTime: unknown }) => ({
          dayOfWeek: Number(d.DayOfWeek),
          dayNameAr: DAY_NAMES_AR[Number(d.DayOfWeek)] ?? String(d.DayOfWeek),
          isWorking: Boolean(d.IsWorking),
          startTime: hhmm(d.StartTime),
          endTime: hhmm(d.EndTime),
        }),
      );
    }

    const pay = await db
      .request()
      .input('empId', sql.Int, empId)
      .input('branchId', sql.Int, GLEEM_BRANCH_ID)
      .query(`
        SELECT TOP 1 PayType, HourlyRate, DailyRate, MonthlySalary, EffectiveFrom
        FROM dbo.TblEmpBranchPayrollPlan
        WHERE EmpID=@empId AND BranchID=@branchId AND IsActive=1
        ORDER BY EffectiveFrom DESC
      `);
    const p = pay.recordset[0] as
      | {
          PayType: string;
          HourlyRate: number | null;
          DailyRate: number | null;
          MonthlySalary: number | null;
        }
      | undefined;
    const gleemPayrollSummary = p
      ? `${p.PayType}: h=${p.HourlyRate ?? '-'} d=${p.DailyRate ?? '-'} m=${p.MonthlySalary ?? '-'}`
      : 'لا خطة على جليم';

    const tgt = await db
      .request()
      .input('empId', sql.Int, empId)
      .input('branchId', sql.Int, GLEEM_BRANCH_ID)
      .query(`
        SELECT TOP 1 IsEnabled, Notes, EffectiveFrom
        FROM dbo.TblEmpTargetPlan
        WHERE EmpID=@empId AND BranchID=@branchId
        ORDER BY CASE WHEN IsEnabled=1 THEN 0 ELSE 1 END, EffectiveFrom DESC
      `);
    const t = tgt.recordset[0] as { IsEnabled: boolean; Notes: string | null } | undefined;
    const gleemTargetSummary = t
      ? t.IsEnabled
        ? 'TARGET_PLAN مفعّل'
        : String(t.Notes || '').includes('NO_TARGET')
          ? 'NO_TARGET'
          : 'خطة غير مفعّلة'
      : 'لا سياسة تارجت';

    const cc = await db
      .request()
      .input('empId', sql.Int, empId)
      .input('branchId', sql.Int, branchId)
      .query(`
        SELECT TOP 1 ID, CanReceiveBookings, Notes, IsActive
        FROM dbo.TblEmpBranchAssignment
        WHERE EmpID=@empId AND BranchID=@branchId AND IsActive=1
        ORDER BY ID DESC
      `);
    const assign = cc.recordset[0] as
      | { ID: number; CanReceiveBookings: boolean; Notes: string | null }
      | undefined;

    let campCaesarPayrollSummary: string | null = null;
    let campCaesarTargetSummary: string | null = null;
    let campCaesarScheduleSummary: string | null = null;
    let campCaesarServicesSummary: string | null = null;
    let canOperate = false;

    if (assign) {
      const notes = String(assign.Notes || '');
      const svcMatch = notes.match(/services:([\d,]+)/i);
      campCaesarServicesSummary = svcMatch ? `خدمات: ${svcMatch[1]}` : 'بدون خدمات مسجّلة';
      canOperate = /services:\d/i.test(notes);

      const ccPay = await db
        .request()
        .input('empId', sql.Int, empId)
        .input('branchId', sql.Int, branchId)
        .query(`
          SELECT TOP 1 PayType, HourlyRate, DailyRate, MonthlySalary
          FROM dbo.TblEmpBranchPayrollPlan
          WHERE EmpID=@empId AND BranchID=@branchId AND IsActive=1
          ORDER BY EffectiveFrom DESC
        `);
      const cp = ccPay.recordset[0];
      campCaesarPayrollSummary = cp
        ? `${cp.PayType}: h=${cp.HourlyRate ?? '-'} d=${cp.DailyRate ?? '-'} m=${cp.MonthlySalary ?? '-'}`
        : null;

      const ccT = await db
        .request()
        .input('empId', sql.Int, empId)
        .input('branchId', sql.Int, branchId)
        .query(`
          SELECT TOP 1 IsEnabled, Notes
          FROM dbo.TblEmpTargetPlan
          WHERE EmpID=@empId AND BranchID=@branchId
          ORDER BY CASE WHEN IsEnabled=1 THEN 0 ELSE 1 END, EffectiveFrom DESC
        `);
      const ct = ccT.recordset[0] as { IsEnabled: boolean; Notes: string | null } | undefined;
      campCaesarTargetSummary = ct
        ? ct.IsEnabled
          ? 'TARGET_PLAN'
          : String(ct.Notes || '').includes('NO_TARGET')
            ? 'NO_TARGET'
            : 'غير محدد'
        : null;

      const ccSched = await db
        .request()
        .input('empId', sql.Int, empId)
        .input('branchId', sql.Int, branchId)
        .query(`
          SELECT DayOfWeek, IsWorking, StartTime, EndTime
          FROM dbo.TblEmpBranchWorkSchedule
          WHERE EmpID=@empId AND BranchID=@branchId AND IsActive=1
          ORDER BY DayOfWeek
        `);
      const days = ccSched.recordset.map(
        (d: { DayOfWeek: number; IsWorking: boolean; StartTime: unknown; EndTime: unknown }) => ({
          dayOfWeek: Number(d.DayOfWeek),
          dayNameAr: DAY_NAMES_AR[Number(d.DayOfWeek)] ?? String(d.DayOfWeek),
          isWorking: Boolean(d.IsWorking),
          startTime: hhmm(d.StartTime),
          endTime: hhmm(d.EndTime),
        }),
      );
      campCaesarScheduleSummary = summarizeDays(days);
    }

    const readinessNotes: string[] = [];
    let readinessStatus: LaunchRosterEmployee['readinessStatus'] = 'not_assigned';
    if (!assign) {
      readinessStatus = 'not_assigned';
      readinessNotes.push('غير معيّن على كامب شيزار');
    } else {
      if (!campCaesarPayrollSummary) readinessNotes.push('ينقص خطة راتب');
      if (!campCaesarTargetSummary) readinessNotes.push('ينقص سياسة تارجت');
      if (!campCaesarServicesSummary || campCaesarServicesSummary.includes('بدون')) {
        readinessNotes.push('ينقص خدمات');
      }
      if (!campCaesarScheduleSummary || campCaesarScheduleSummary === 'لا أيام عمل') {
        readinessNotes.push('ينقص جدول عمل');
      }
      readinessStatus = readinessNotes.length ? 'partial' : 'ready';
    }

    employees.push({
      empId,
      empName: row.EmpName,
      job: row.Job,
      gleemDays,
      gleemHoursSummary: summarizeDays(gleemDays),
      gleemServicesSummary: 'كتالوج CUT العام (مسودة عند التعيين)',
      gleemPayrollSummary,
      gleemTargetSummary,
      campCaesarAssigned: !!assign,
      campCaesarAssignmentId: assign ? Number(assign.ID) : null,
      campCaesarCanReceiveBookings: assign ? Boolean(assign.CanReceiveBookings) : false,
      campCaesarCanOperate: canOperate,
      campCaesarPayrollSummary,
      campCaesarTargetSummary,
      campCaesarScheduleSummary,
      campCaesarServicesSummary,
      readinessStatus,
      readinessNotes,
    });
  }

  return { branchId, gleemBranchId: GLEEM_BRANCH_ID, employees };
}

export async function listLaunchCoverageDashboard(branchId: number): Promise<{
  rows: LaunchCoverageRow[];
}> {
  const { employees } = await listLaunchRosterEmployees(branchId);
  const assigned = employees.filter((e) => e.campCaesarAssigned);
  const rows: LaunchCoverageRow[] = assigned.map((e) => {
    const blockers: string[] = [...e.readinessNotes];
    if (!e.campCaesarCanReceiveBookings) blockers.push('الحجز غير مفعّل');
    if (!e.campCaesarCanOperate) blockers.push('التشغيل بدون خدمات');
    return {
      empId: e.empId,
      empName: e.empName,
      assignment: e.campCaesarAssigned ? 'نشط' : '—',
      schedule: e.campCaesarScheduleSummary ?? '—',
      services: e.campCaesarServicesSummary ?? '—',
      payroll: e.campCaesarPayrollSummary ?? '—',
      target: e.campCaesarTargetSummary ?? '—',
      bookingEligibility: e.campCaesarCanReceiveBookings ? 'يمكنه استقبال حجوزات' : 'لا',
      finalStatus: blockers.length ? 'blocked' : 'ready',
      blockers,
    };
  });
  return { rows };
}

export async function commitLaunchRosterAssignment(
  input: CommitEmployeeBranchAssignmentInput,
): Promise<Awaited<ReturnType<typeof commitEmployeeBranchAssignment>>> {
  return commitEmployeeBranchAssignment(input);
}

export async function removeLaunchRosterAssignment(args: {
  empId: number;
  branchId: number;
  actorUserId?: number | null;
}): Promise<{ deactivated: boolean }> {
  const db = await getPool();
  const result = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('branchId', sql.Int, args.branchId)
    .query(`
      UPDATE dbo.TblEmpBranchAssignment
      SET IsActive = 0, UpdatedAt = SYSUTCDATETIME()
      WHERE EmpID = @empId AND BranchID = @branchId AND IsActive = 1
    `);
  if (!result.rowsAffected[0]) {
    throw new BranchDomainError('OPERATION_NOT_ALLOWED', 'لا يوجد تعيين نشط للإزالة', 404);
  }
  // Soft-end branch schedule rows for this branch
  await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('branchId', sql.Int, args.branchId)
    .query(`
      UPDATE dbo.TblEmpBranchWorkSchedule
      SET IsActive = 0, UpdatedAt = SYSUTCDATETIME()
      WHERE EmpID = @empId AND BranchID = @branchId AND IsActive = 1
    `);
  return { deactivated: true };
}

export async function loadBookableServiceCatalog(): Promise<
  Array<{ proId: number; proName: string; price: number; durationMinutes: number }>
> {
  const db = await getPool();
  const res = await db.request().query(`
    SELECT p.ProID, p.ProName, ISNULL(p.SPrice1, p.PPrice) AS Price, ISNULL(p.DurationMinutes, 0) AS DurationMinutes
    FROM dbo.TblPro p
    LEFT JOIN dbo.TblCat c ON c.CatID = p.CatID
    WHERE ISNULL(p.isDeleted, 0) = 0
      AND ISNULL(p.SPrice1, p.PPrice) > 0
      AND LOWER(ISNULL(p.ProType, N'')) NOT IN (N'pro', N'product')
      AND LOWER(ISNULL(c.CatType, N'')) <> N'pro'
      AND ISNULL(c.CatName, N'') NOT LIKE N'%منتج%'
    ORDER BY p.ProName
  `);
  return res.recordset.map(
    (r: { ProID: number; ProName: string; Price: number; DurationMinutes: number }) => ({
      proId: Number(r.ProID),
      proName: String(r.ProName),
      price: Number(r.Price),
      durationMinutes: Number(r.DurationMinutes),
    }),
  );
}
