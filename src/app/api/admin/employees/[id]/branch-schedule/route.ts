import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, isAuthResult } from '@/lib/api-auth';
import { getPool, sql } from '@/lib/db';
import {
  resolveEmployeeGlobalSchedule,
} from '@/lib/hr/employeeBranchScheduleResolver';
import {
  saveEmployeeBranchWeeklySchedule,
  SchedulePolicyError,
} from '@/lib/hr/employeeBranchScheduleSave';
import {
  saveEmployeeGlobalWeeklySchedule,
} from '@/lib/hr/employeeGlobalWeeklyScheduleSave';
import { ensureEmpBranchWorkScheduleTable } from '@/lib/hr/empBranchWorkSchedule';
import { getCairoBusinessDate } from '@/lib/businessDate';

export const runtime = 'nodejs';

const DAY_NAMES_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/**
 * GET /api/admin/employees/[id]/branch-schedule?from=YYYY-MM-DD
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;

  try {
    const { id } = await ctx.params;
    const empId = Number(id);
    if (!Number.isFinite(empId)) {
      return NextResponse.json({ error: 'empId غير صالح' }, { status: 400 });
    }

    const from =
      new URL(req.url).searchParams.get('from') || getCairoBusinessDate();
    const start = new Date(`${from}T12:00:00Z`);
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());

    await ensureEmpBranchWorkScheduleTable();
    const db = await getPool();

    const empRes = await db
      .request()
      .input('empId', sql.Int, empId)
      .query(`
        SELECT EmpID, EmpName, ISNULL(isActive, 1) AS IsActive
        FROM dbo.TblEmp WHERE EmpID = @empId
      `);
    if (!empRes.recordset[0]) {
      return NextResponse.json({ error: 'الموظف غير موجود' }, { status: 404 });
    }

    const branches = await db
      .request()
      .input('empId', sql.Int, empId)
      .input('day', sql.Date, from)
      .query(`
        SELECT DISTINCT b.BranchID, b.BranchCode, b.BranchName, b.LifecycleStatus,
               b.IsActive, b.DefaultOpenTime, b.DefaultCloseTime
        FROM dbo.TblEmpBranchAssignment a
        INNER JOIN dbo.TblBranch b ON b.BranchID = a.BranchID
        WHERE a.EmpID = @empId AND a.IsActive = 1
          AND a.EffectiveFrom <= @day
          AND (a.EffectiveTo IS NULL OR a.EffectiveTo >= @day)
        ORDER BY b.BranchID
      `);

    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      const date = d.toISOString().slice(0, 10);
      const global = await resolveEmployeeGlobalSchedule({
        empId,
        workDate: date,
        publicOnly: false,
      });
      const byBranch: Record<string, unknown> = {};
      for (const b of branches.recordset) {
        const match = global.branches.find((x) => x.branchId === Number(b.BranchID));
        byBranch[String(b.BranchCode)] = match
          ? {
              isWorking: true,
              startTime: match.startTime,
              endTime: match.endTime,
              overnight: match.endDayOffset === 1,
              source: match.source,
              canReceiveBookings: match.canReceiveBookings,
            }
          : { isWorking: false };
      }
      days.push({
        date,
        dayOfWeek: i,
        dayNameAr: DAY_NAMES_AR[i],
        branches: byBranch,
        globalResult: global.branches[0]
          ? {
              branchId: global.branches[0].branchId,
              branchCode: global.branches[0].branchCode,
              branchName: global.branches[0].branchName,
              startTime: global.branches[0].startTime,
              endTime: global.branches[0].endTime,
              overnight: global.branches[0].endDayOffset === 1,
            }
          : null,
        isGlobalDayOff: global.isGlobalDayOff,
        conflict: global.conflict,
      });
    }

    const fmtTime = (v: unknown) =>
      v == null ? null : typeof v === 'string' ? v.slice(0, 5) : String(v).slice(0, 5);

    return NextResponse.json({
      ok: true,
      empId,
      employee: {
        empId,
        empName: String(empRes.recordset[0].EmpName),
        isActive: Boolean(empRes.recordset[0].IsActive),
      },
      weekStart: start.toISOString().slice(0, 10),
      assignedBranches: branches.recordset.map((b) => ({
        branchId: Number(b.BranchID),
        branchCode: String(b.BranchCode),
        branchName: String(b.BranchName),
        lifecycleStatus: String(b.LifecycleStatus),
        isActive: Boolean(b.IsActive),
        defaultOpenTime: fmtTime(b.DefaultOpenTime),
        defaultCloseTime: fmtTime(b.DefaultCloseTime),
      })),
      days,
    });
  } catch (err) {
    console.error('[branch-schedule GET]', err);
    return NextResponse.json({ error: 'فشل تحميل الجدول' }, { status: 500 });
  }
}

/**
 * PUT — Phase 1R global days[] or Phase 1Q single-branch cells[].
 */
export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;

  try {
    const { id } = await ctx.params;
    const empId = Number(id);
    const body = await req.json();

    if (!Number.isFinite(empId)) {
      return NextResponse.json({ error: 'empId غير صالح' }, { status: 400 });
    }

    if (Array.isArray(body.days)) {
      const result = await saveEmployeeGlobalWeeklySchedule({
        empId,
        effectiveFrom: String(body.effectiveFrom || ''),
        days: body.days,
        reason: body.reason,
        actorUserId: auth.userId,
        allowAffectingBookings: body.allowAffectingBookings === true,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    const branchId = Number(body.branchId);
    const effectiveFrom = String(body.effectiveFrom || '');
    const cells = Array.isArray(body.cells) ? body.cells : [];

    if (!Number.isFinite(branchId) || !effectiveFrom || !cells.length) {
      return NextResponse.json({ error: 'معاملات ناقصة' }, { status: 400 });
    }

    const result = await saveEmployeeBranchWeeklySchedule({
      empId,
      branchId,
      effectiveFrom,
      effectiveTo: body.effectiveTo ?? null,
      cells,
      actorUserId: auth.userId,
      skipPayrollCheck: body.skipPayrollCheck === true,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof SchedulePolicyError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message, details: err.details },
        { status: err.status },
      );
    }
    console.error('[branch-schedule PUT]', err);
    return NextResponse.json({ error: 'فشل حفظ الجدول' }, { status: 500 });
  }
}
