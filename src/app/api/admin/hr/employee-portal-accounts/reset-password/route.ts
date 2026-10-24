import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { hashPassword } from '@/lib/auth/passwordHash';
import { requirePageAccess, isAuthResult } from '@/lib/api-auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;
  if (auth.userLevel !== 'admin' && !auth.isSuperAdmin) {
    return NextResponse.json({ error: 'ADMIN_REQUIRED' }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as { empId?: unknown; confirm?: unknown } | null;
  if (!Number.isSafeInteger(body?.empId) || Number(body?.empId) <= 0 || body?.confirm !== 'RESET_EMPLOYEE_PASSWORD') {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }

  const db = await getPool();
  const hashed = await hashPassword('12341234');
  try {
    const result = await db.request()
      .input('tenantId', sql.UniqueIdentifier, auth.tenantId)
      .input('empId', sql.Int, Number(body.empId))
      .input('hash', sql.NVarChar(255), hashed)
      .query(`
        UPDATE a
        SET PasswordHash = @hash,
            MustChangePassword = 1,
            FailedAttempts = 0,
            LockedUntil = NULL,
            UpdatedAt = SYSUTCDATETIME()
        FROM dbo.TblEmployeePortalAccount a
        INNER JOIN dbo.TblEmp e ON e.EmpID = a.EmpID AND e.TenantId = a.TenantId
        WHERE a.EmpID = @empId
          AND a.TenantId = @tenantId
          AND e.isActive = 1
          AND a.IsEnabled = 1
      `);
    if (result.rowsAffected[0] !== 1) {
      return NextResponse.json({ error: 'ACCOUNT_NOT_FOUND_OR_DISABLED' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, empId: Number(body.empId) });
  } catch (error) {
    console.error('[employee-portal/admin/reset-password]', error instanceof Error ? error.name : 'unknown');
    return NextResponse.json({ error: 'RESET_FAILED' }, { status: 500 });
  }
}
