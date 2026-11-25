import { NextResponse } from 'next/server';
import { isAuthResult, requireAdmin } from '@/lib/api-auth';
import { getPool, sql } from '@/lib/db';
import { getBranchById } from '@/lib/branch/repository';
import { evaluateTenantGoLive } from '@/platform/onboarding/goLiveReadiness';
import { buildSelfServiceJourney } from '@/platform/onboarding/selfServiceJourney';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Read-only: tenant always comes from the verified staff session, never a query parameter. */
export async function GET() {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;

  try {
    const report = await evaluateTenantGoLive(auth.tenantId);
    if (!report || report.tenantId.toLowerCase() !== auth.tenantId.toLowerCase()) {
      return NextResponse.json(
        { ok: false, code: 'TENANT_NOT_FOUND', error: 'المنشأة غير موجودة.' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const pool = await getPool();
    const [branch, assigned] = await Promise.all([
      getBranchById(auth.activeBranchId),
      pool.request().input('tenantId', sql.UniqueIdentifier, auth.tenantId).input('branchId', sql.Int, auth.activeBranchId).query(`
        SELECT COUNT(*) AS n FROM dbo.TblEmp e
        WHERE e.TenantId = @tenantId AND ISNULL(e.isActive, 1) = 1
          AND EXISTS (SELECT 1 FROM dbo.TblEmpBranchAssignment a WHERE a.EmpID = e.EmpID
            AND a.BranchID = @branchId AND a.IsActive = 1
            AND a.EffectiveFrom <= CAST(GETUTCDATE() AS date)
            AND (a.EffectiveTo IS NULL OR a.EffectiveTo >= CAST(GETUTCDATE() AS date)));
      `),
    ]);
    const branchDetails = branch ? {
      name: branch.branchName,
      assignedTeamCount: Number(assigned.recordset[0]?.n ?? 0),
      complete: Boolean(branch.isActive && branch.address?.trim() && branch.phone?.trim() && branch.defaultOpenTime && branch.defaultCloseTime && branch.defaultOpenTime !== branch.defaultCloseTime),
    } : { name: 'الفرع الحالي', complete: false, assignedTeamCount: 0 };
    return NextResponse.json(
      { ok: true, journey: buildSelfServiceJourney(report, branchDetails) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('[tenant/onboarding] read failed:', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { ok: false, code: 'SETUP_UNAVAILABLE', error: 'تعذر تحميل خطوات التجهيز. حاول مرة تانية.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
