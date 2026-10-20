import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { hashPassword } from '@/lib/auth/passwordHash';
import { requirePageAccess, isAuthResult } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireHrAdmin() {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;
  if (auth.userLevel !== 'admin' && !auth.isSuperAdmin) {
    return NextResponse.json({ error: 'ADMIN_REQUIRED' }, { status: 403 });
  }
  return auth;
}
export async function GET() {
  const auth = await requireHrAdmin();
  if (!isAuthResult(auth)) return auth;
  const db = await getPool();
  const result = await db.request().input('tenantId', auth.tenantId).query(`
    SELECT e.EmpID, e.EmpName, e.Job, e.isActive,
      a.LoginName, a.IsEnabled, a.CreatedAt
    FROM dbo.TblEmp e
    LEFT JOIN dbo.TblEmployeePortalAccount a ON a.EmpID = e.EmpID AND a.TenantId = e.TenantId
    WHERE e.TenantId = @tenantId AND e.isActive = 1
    ORDER BY e.EmpName
  `);
  return NextResponse.json({ employees: result.recordset });
}
export async function POST(request: NextRequest) {
  const auth = await requireHrAdmin();
  if (!isAuthResult(auth)) return auth;
  try {
    const body = await request.json() as { empId?: unknown; username?: unknown; password?: unknown };
    if (!Number.isSafeInteger(body.empId) || Number(body.empId) <= 0 ||
      typeof body.username !== 'string' || !/^[a-zA-Z0-9._-]{3,60}$/.test(body.username) ||
      typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 128) {
      return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
    }
    const db = await getPool();
    const empId = Number(body.empId);
    const hashed = await hashPassword(body.password);
    const tx = db.transaction();
    await tx.begin();
    try {
      const employee = await tx.request().input('empId', empId).input('tenantId', auth.tenantId).query(`
        SELECT EmpID FROM dbo.TblEmp WITH (UPDLOCK, HOLDLOCK)
        WHERE EmpID = @empId AND TenantId = @tenantId AND isActive = 1
      `);
      if (!employee.recordset.length) {
        await tx.rollback();
        return NextResponse.json({ error: 'EMPLOYEE_NOT_FOUND' }, { status: 404 });
      }
      await tx.request().input('empId', empId).input('tenantId', auth.tenantId)
        .input('loginName', body.username).input('hash', hashed).query(`
        IF EXISTS (SELECT 1 FROM dbo.TblEmployeePortalAccount WITH (UPDLOCK, HOLDLOCK) WHERE EmpID=@empId AND TenantId=@tenantId)
          UPDATE dbo.TblEmployeePortalAccount
          SET LoginName=@loginName, PasswordHash=@hash, IsEnabled=1, UpdatedAt=SYSUTCDATETIME()
          WHERE EmpID=@empId AND TenantId=@tenantId
        ELSE
          INSERT INTO dbo.TblEmployeePortalAccount(EmpID, TenantId, LoginName, PasswordHash)
          VALUES (@empId, @tenantId, @loginName, @hash)
      `);
      await tx.commit();
      return NextResponse.json({ ok: true });
    } catch (error) { await tx.rollback(); throw error; }
  } catch (error) {
    console.error('[employee-portal/admin] failed', error instanceof Error ? error.name : 'unknown');
    return NextResponse.json({ error: 'SAVE_FAILED' }, { status: 500 });
  }
}
