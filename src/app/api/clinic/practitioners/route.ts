import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import {
  isAuthResult,
  requireAdmin,
  requireTenantApp,
  withTenantApp,
} from '@/lib/api-auth';
import { ensureEmployeeBranchAssignment } from '@/lib/branch/assignmentIntegrity';
import { invalidatePublicBookingBarbersCache } from '@/lib/booking/publicBookingBarbers';
import { getCairoBusinessDate } from '@/lib/businessDate';
import { createTenantEmployee } from '@/lib/hr/tenantEmployeeCreate';
import { registerClinicPractitioner } from '@/apps/medical-records/internal/repository';

export async function GET() {
  const auth = await requireTenantApp('medical-records');
  if (!isAuthResult(auth)) return auth;

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('tenantId', sql.UniqueIdentifier, auth.tenantId)
      .input('branchId', sql.Int, auth.activeBranchId)
      .input('day', sql.Date, getCairoBusinessDate())
      .query(`
        SELECT DISTINCT e.EmpID, e.EmpName, e.Job, p.UserID
        FROM dbo.TblEmp e
        INNER JOIN dbo.TblEmpBranchAssignment a ON a.EmpID = e.EmpID
        LEFT JOIN dbo.ClinicPractitioner p
          ON p.TenantId=e.TenantId AND p.EmpID=e.EmpID AND p.IsActive=1
        WHERE e.TenantId = @tenantId
          AND ISNULL(e.isActive, 1) = 1
          AND e.Job IN (N'طبيب', N'Doctor', N'doctor')
          AND a.BranchID = @branchId
          AND a.IsActive = 1
          AND a.EffectiveFrom <= @day
          AND (a.EffectiveTo IS NULL OR a.EffectiveTo >= @day)
        ORDER BY e.EmpName;
      `);
    return NextResponse.json(result.recordset);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/clinic/practitioners] GET error:', message);
    return NextResponse.json({ error: 'تعذر تحميل الأطباء' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await withTenantApp('medical-records', requireAdmin());
  if (!isAuthResult(auth)) return auth;

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const name = String(body.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
    const linkCurrentUser = body.linkCurrentUser === true;
    const targetUserId = body.userId == null || body.userId === '' ? null : Number(body.userId);
    if (targetUserId !== null && (!Number.isSafeInteger(targetUserId) || targetUserId <= 0 || targetUserId > 2147483647)) {
      return NextResponse.json({ error: 'اختار حساب دخول صحيح للطبيب' }, { status: 400 });
    }
    if (linkCurrentUser && targetUserId !== null) {
      return NextResponse.json({ error: 'اختار حساب دخول واحد للطبيب' }, { status: 400 });
    }
    const clinicalUserId = linkCurrentUser ? auth.userId : targetUserId;
    if (name.length < 2) {
      return NextResponse.json({ error: 'اسم الطبيب مطلوب' }, { status: 400 });
    }

    const pool = await getPool();
    const existing = await pool.request()
      .input('tenantId', sql.UniqueIdentifier, auth.tenantId)
      .input('name', sql.NVarChar(200), name)
      .query(`
        SELECT TOP 1 EmpID, EmpName, Job
        FROM dbo.TblEmp
        WHERE TenantId=@tenantId
          AND EmpName=@name
          AND ISNULL(isActive,1)=1;
      `);

    let empId: number;
    let created = false;
    if (existing.recordset[0]) {
      const row = existing.recordset[0] as { EmpID: number; Job: string | null };
      if (!['طبيب', 'Doctor', 'doctor'].includes(String(row.Job ?? ''))) {
        return NextResponse.json(
          { error: 'يوجد موظف بنفس الاسم لكنه غير مسجل كطبيب' },
          { status: 409 },
        );
      }
      empId = Number(row.EmpID);
    } else {
      ({ empId } = await createTenantEmployee({
        tenantId: auth.tenantId,
        name,
        job: 'طبيب',
        isActive: true,
      }));
      created = true;
    }

    await ensureEmployeeBranchAssignment({
      empId,
      branchId: auth.activeBranchId,
      effectiveFrom: getCairoBusinessDate(),
      canReceiveBookings: true,
      isHomeBranch: true,
    });
    await registerClinicPractitioner({
      tenantId: auth.tenantId,
      empId,
      userId: clinicalUserId,
      actorUserId: auth.userId,
    });
    invalidatePublicBookingBarbersCache();

    return NextResponse.json(
      {
        EmpID: empId,
        EmpName: name,
        Job: 'طبيب',
        UserID: clinicalUserId,
        created,
        linkedToCurrentUser: clinicalUserId === auth.userId,
      },
      { status: created ? 201 : 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/clinic/practitioners] POST error:', message);
    return NextResponse.json({ error: 'تعذر إضافة الطبيب' }, { status: 500 });
  }
}
