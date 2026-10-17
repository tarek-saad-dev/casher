import { NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { authorizeDrvoPosOperationalRead } from '@/platform/pos/authorizePosRead';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Active employees explicitly assigned to the signed-in tenant's current branch. */
export async function GET() {
  const access = await authorizeDrvoPosOperationalRead();
  if (!access.ok) return NextResponse.json({ ok: false, code: access.code }, {
    status: access.status, headers: { 'Cache-Control': 'no-store' },
  });
  try {
    const db = await getPool();
    const result = await db.request()
      .input('tenantId', sql.UniqueIdentifier, access.context.tenantId)
      .input('locationId', sql.UniqueIdentifier, access.context.activeLocation.locationId)
      .input('branchId', sql.Int, access.context.activeLocation.legacyBranchId)
      .query<{ empId: number; name: string }>(`
        SELECT DISTINCT TOP (100) e.EmpID AS empId, e.EmpName AS name
        FROM dbo.TblEmp AS e
        JOIN dbo.TblEmpBranchAssignment AS a
          ON a.EmpID = e.EmpID AND a.BranchID = @branchId
          AND a.IsActive = 1
          AND a.EffectiveFrom <= CONVERT(date, SYSDATETIME())
          AND (a.EffectiveTo IS NULL OR a.EffectiveTo >= CONVERT(date, SYSDATETIME()))
        JOIN dbo.Location AS l ON l.TenantId = e.TenantId
          AND l.LegacyBranchId = a.BranchID
          AND l.LocationId = @locationId AND l.Status = N'active'
        JOIN dbo.Tenant AS t ON t.TenantId = l.TenantId AND t.Status = N'active'
        WHERE e.TenantId = @tenantId
          AND ISNULL(e.isActive, 0) = 1 AND e.IsArchived = 0
        ORDER BY e.EmpName
      `);
    return NextResponse.json({
      ok: true,
      tenantId: access.context.tenantId,
      locationId: access.context.activeLocation.locationId,
      employees: result.recordset,
      assignmentScope: 'active_branch_assignment',
      sellable: false,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[drvo/pos/employees] unavailable', error instanceof Error ? error.name : 'unknown');
    return NextResponse.json({ ok: false, code: 'POS_EMPLOYEES_UNAVAILABLE' }, {
      status: 503, headers: { 'Cache-Control': 'no-store' },
    });
  }
}
