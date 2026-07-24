import { NextResponse, NextRequest } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getActiveBranchContext } from '@/lib/branch/context';
import { getGlobalTimingDefaults, getPublicSettings } from '@/lib/publicBookingHelpers';

/**
 * GET /api/services/:proId/barber-durations
 *
 * Returns all active barbers with their override duration (if any) for this service.
 * effectiveDurationMinutes resolves: override → service default → system default (30).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const proId = parseInt(id);
    if (isNaN(proId)) {
      return NextResponse.json({ error: 'معرف الخدمة غير صالح' }, { status: 400 });
    }

    const db = await getPool();

    // Fetch service info
    const svcRes = await db.request()
      .input('ProID', sql.Int, proId)
      .query(`SELECT ProID, ProName, DurationMinutes FROM dbo.TblPro WHERE ProID = @ProID`);

    if (!svcRes.recordset[0]) {
      return NextResponse.json({ error: 'الخدمة غير موجودة' }, { status: 404 });
    }
    const svc = svcRes.recordset[0];

    // Fetch system default duration — prefer the caller's active branch settings when
    // authenticated (session-scoped), otherwise fall back to global timing defaults
    // (this endpoint is read by both ops staff and unauthenticated callers).
    let systemDefault = 30;
    try {
      const activeBranch = await getActiveBranchContext();
      const settings = activeBranch
        ? await getPublicSettings(activeBranch.branchId)
        : await getGlobalTimingDefaults();
      systemDefault = settings.defaultServiceDurationMinutes ?? 30;
    } catch {
      // Fallback to hardcoded default
    }
    const serviceDefault: number | null = svc.DurationMinutes ?? null;

    // Fetch all active barbers
    const barbersRes = await db.request().query(`
      SELECT EmpID, EmpName FROM dbo.TblEmp
      WHERE ISNULL(isActive,1) = 1
        AND Job IN (N'حلاق', N'مساعد', N'Barber', N'barber')
      ORDER BY EmpName
    `).catch(() => ({ recordset: [] as any[] }));

    if (!barbersRes.recordset.length) {
      return NextResponse.json({ ok: true, service: { id: proId, name: svc.ProName, defaultDurationMinutes: serviceDefault }, barbers: [] });
    }

    const barberIds = barbersRes.recordset.map((r: any) => r.EmpID as number);

    // Fetch overrides for this service across all barbers
    const ovRes = await db.request()
      .input('ProID', sql.Int, proId)
      .query(`
        SELECT EmpID, DurationMinutes FROM dbo.TblEmpServiceSettings
        WHERE ProID = @ProID AND IsActive = 1
          AND EmpID IN (${barberIds.join(',')})
      `).catch(() => ({ recordset: [] as any[] }));

    const overrideMap: Record<number, number> = {};
    for (const r of ovRes.recordset) overrideMap[r.EmpID] = r.DurationMinutes;

    const barbers = barbersRes.recordset.map((emp: any) => {
      const override: number | null = overrideMap[emp.EmpID] ?? null;
      let effectiveDurationMinutes: number;
      let durationSource: string;

      if (override !== null) {
        effectiveDurationMinutes = override;
        durationSource = 'EMP_SERVICE_OVERRIDE';
      } else if (serviceDefault !== null) {
        effectiveDurationMinutes = serviceDefault;
        durationSource = 'SERVICE_DEFAULT';
      } else {
        effectiveDurationMinutes = systemDefault;
        durationSource = 'SYSTEM_DEFAULT';
      }

      return {
        empId: emp.EmpID,
        empName: emp.EmpName,
        overrideDurationMinutes: override,
        effectiveDurationMinutes,
        durationSource,
      };
    });

    return NextResponse.json({
      ok: true,
      service: {
        id: proId,
        name: svc.ProName,
        defaultDurationMinutes: serviceDefault,
        systemDefaultMinutes: systemDefault,
      },
      barbers,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/services/[id]/barber-durations] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/services/:proId/barber-durations
 *
 * Body: { items: [{ empId, durationMinutes: number | null }] }
 * - number → upsert TblEmpServiceSettings (IsActive=1)
 * - null   → deactivate override (IsActive=0)
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const proId = parseInt(id);
    if (isNaN(proId)) {
      return NextResponse.json({ error: 'معرف الخدمة غير صالح' }, { status: 400 });
    }

    const body = await req.json();
    const items = body?.items as Array<{ empId: number; durationMinutes: number | null }>;

    if (!Array.isArray(items) || !items.length) {
      return NextResponse.json({ error: 'items مطلوب' }, { status: 400 });
    }

    const db = await getPool();

    // Validate service exists
    const svcCheck = await db.request()
      .input('ProID', sql.Int, proId)
      .query(`SELECT 1 AS ex FROM dbo.TblPro WHERE ProID = @ProID`);
    if (!svcCheck.recordset[0]) {
      return NextResponse.json({ error: 'الخدمة غير موجودة' }, { status: 404 });
    }

    let processed = 0;
    for (const item of items) {
      const empId = Number(item.empId);
      const dur = item.durationMinutes;

      if (!empId || isNaN(empId)) continue;

      if (dur === null || dur === undefined) {
        // Deactivate override
        await db.request()
          .input('EmpID', sql.Int, empId)
          .input('ProID', sql.Int, proId)
          .query(`
            UPDATE dbo.TblEmpServiceSettings
            SET IsActive = 0, UpdatedAt = SYSDATETIME()
            WHERE EmpID = @EmpID AND ProID = @ProID
          `).catch(() => {});
      } else {
        if (typeof dur !== 'number' || dur < 5 || dur > 240) {
          return NextResponse.json(
            { error: `مدة غير صالحة للصنايعي ${empId}: يجب أن تكون بين 5 و 240 دقيقة` },
            { status: 400 }
          );
        }
        // Upsert
        await db.request()
          .input('EmpID', sql.Int, empId)
          .input('ProID', sql.Int, proId)
          .input('DurationMinutes', sql.Int, dur)
          .query(`
            MERGE dbo.TblEmpServiceSettings AS t
            USING (SELECT @EmpID AS EmpID, @ProID AS ProID) AS s
              ON t.EmpID = s.EmpID AND t.ProID = s.ProID
            WHEN MATCHED THEN
              UPDATE SET DurationMinutes = @DurationMinutes, IsActive = 1, UpdatedAt = SYSDATETIME()
            WHEN NOT MATCHED THEN
              INSERT (EmpID, ProID, DurationMinutes, IsActive)
              VALUES (@EmpID, @ProID, @DurationMinutes, 1);
          `);
      }
      processed++;
    }

    return NextResponse.json({ ok: true, processed });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/services/[id]/barber-durations] PATCH error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
