import { NextResponse } from 'next/server';
import { isAuthResult, requireTemporaryTransferAccess } from '@/lib/api-auth';
import { getPool, sql } from '@/lib/db';
import { requireMasterDataTenantId } from '@/platform/masterData/tenantScope';
import { listActiveBranches } from '@/lib/branch/repository';
import { listTenantLegacyBranchIds } from '@/platform/tenant/tenantContext';

export const runtime = 'nodejs';

/**
 * GET /api/admin/hr/branch-transfer/meta
 * Employees + transfer destinations for the full HR transfer page.
 */
export async function GET() {
  const auth = await requireTemporaryTransferAccess();
  if (!isAuthResult(auth)) return auth;

  try {
    const db = await getPool();
    const tenantId = requireMasterDataTenantId(auth.tenantId, 'GET /api/admin/hr/branch-transfer/meta');
    const emps = await db.request().input('tenantId', sql.UniqueIdentifier, tenantId).query(`
      SELECT EmpID, EmpName, Job
      FROM dbo.TblEmp
      WHERE TenantId = @tenantId AND ISNULL(isActive, 1) = 1
      ORDER BY EmpName
    `);

    const tenantBranchIds = await listTenantLegacyBranchIds(tenantId);
    const branches = await listActiveBranches();
    const destinations = branches
      .filter((b) => b.lifecycleStatus !== 'SETUP' && tenantBranchIds.has(b.branchId))
      .map((b) => ({
        branchId: b.branchId,
        branchCode: b.branchCode,
        branchName: b.branchName,
        lifecycleStatus: b.lifecycleStatus,
      }));

    return NextResponse.json({
      ok: true,
      employees: emps.recordset.map((r) => ({
        empId: Number(r.EmpID),
        empName: String(r.EmpName ?? ''),
        job: r.Job == null ? null : String(r.Job),
      })),
      destinations,
      activeBranchId: auth.activeBranchId,
      activeBranchCode: auth.activeBranchCode,
    });
  } catch (err) {
    console.error('[admin/hr/branch-transfer/meta]', err);
    return NextResponse.json({ ok: false, error: 'فشل تحميل بيانات النقل' }, { status: 500 });
  }
}
