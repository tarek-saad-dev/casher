import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { verifyPassword } from '@/lib/auth/passwordHash';
import { getEmployeePortalIdentity, logoutEmployee } from '@/lib/employee-portal/auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const identity = await getEmployeePortalIdentity();
  if (!identity) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (identity.mustChangePassword) return NextResponse.json({ error: 'PASSWORD_CHANGE_REQUIRED' }, { status: 403 });
  const body = await request.json().catch(() => null) as { username?: unknown; password?: unknown } | null;
  const username = typeof body?.username === 'string' ? body.username.trim().toLowerCase() : '';
  if (!/^[a-z]+(?:[._-][a-z]+)*$/.test(username) || username.length < 3 || username.length > 60 || typeof body?.password !== 'string') {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }
  const db = await getPool();
  const result = await db.request()
    .input('id', identity.accountId).input('empId', identity.empId).input('tenantId', identity.tenantId)
    .query('SELECT LoginName, PasswordHash FROM dbo.TblEmployeePortalAccount WHERE ID=@id AND EmpID=@empId AND TenantId=@tenantId AND IsEnabled=1');
  const account = result.recordset[0] as { LoginName: string; PasswordHash: string } | undefined;
  if (!account || !(await verifyPassword(body.password, account.PasswordHash)).ok) {
    return NextResponse.json({ error: 'WRONG_PASSWORD' }, { status: 403 });
  }
  if (account.LoginName.toLowerCase() === username) {
    return NextResponse.json({ error: 'SAME_USERNAME' }, { status: 400 });
  }
  try {
    const result = await db.request().input('id', identity.accountId)
      .input('empId', identity.empId).input('tenantId', identity.tenantId)
      .input('username', username).input('oldName', account.LoginName)
      .query('UPDATE dbo.TblEmployeePortalAccount SET LoginName=@username, UpdatedAt=SYSUTCDATETIME() WHERE ID=@id AND EmpID=@empId AND TenantId=@tenantId AND LoginName=@oldName AND IsEnabled=1');
    if (result.rowsAffected[0] !== 1) return NextResponse.json({ error: 'RETRY' }, { status: 409 });
  } catch (error) {
    const number = (error as { number?: number }).number;
    if (number === 2601 || number === 2627) return NextResponse.json({ error: 'USERNAME_TAKEN' }, { status: 409 });
    return NextResponse.json({ error: 'SAVE_FAILED' }, { status: 500 });
  }
  await logoutEmployee();
  return NextResponse.json({ ok: true });
}
