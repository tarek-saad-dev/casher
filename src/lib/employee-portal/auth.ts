import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { getPool } from '@/lib/db';
import { verifyPassword, hashPassword } from '@/lib/auth/passwordHash';

const COOKIE = 'cut_employee_portal';
const TTL_SECONDS = 8 * 60 * 60;

type Claims = { empId: number; tenantId: string; accountId: number; expires: number };
function secret(): string {
  const value = process.env.EMPLOYEE_PORTAL_SECRET || process.env.SESSION_SECRET;
  if (!value || (process.env.NODE_ENV === 'production' && value.length < 24)) {
    throw new Error('EMPLOYEE_PORTAL_SECRET is not configured');
  }
  return value;
}
function signature(data: string): string {
  return createHmac('sha256', secret()).update('employee-portal-v1:' + data).digest('base64url');
}
function parse(token?: string): Claims | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const expected = Buffer.from(signature(parts[0]));
  const actual = Buffer.from(parts[1]);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const value = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as Claims;
    if (!Number.isSafeInteger(value.empId) || value.empId <= 0 ||
      !Number.isSafeInteger(value.accountId) || value.accountId <= 0 ||
      typeof value.tenantId !== 'string' || !value.tenantId ||
      !Number.isSafeInteger(value.expires) || value.expires <= Math.floor(Date.now() / 1000)) return null;
    return value;
  } catch { return null; }
}
export async function loginEmployee(loginName: string, password: string): Promise<boolean> {
  const pool = await getPool();
  const result = await pool.request().input('login', loginName).query(`
    SELECT a.ID, a.EmpID, a.TenantId, a.PasswordHash, a.LockedUntil
    FROM dbo.TblEmployeePortalAccount a
    INNER JOIN dbo.TblEmp e ON e.EmpID = a.EmpID
    WHERE a.LoginName = @login AND a.IsEnabled = 1 AND e.isActive = 1 AND e.TenantId = a.TenantId
  `);
  const record = result.recordset[0] as { ID: number; EmpID: number; TenantId: string; PasswordHash: string; LockedUntil: Date | null } | undefined;
  // Verify even for a nonexistent login to minimize user enumeration timing.
  const fakeHash = 's1$AAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const verified = await verifyPassword(password, record?.PasswordHash ?? fakeHash);
  if (!record || (record.LockedUntil && new Date(record.LockedUntil).getTime() > Date.now())) return false;
  if (!verified.ok || verified.needsUpgrade) {
    await pool.request().input('accountId', record.ID).query(`
      UPDATE dbo.TblEmployeePortalAccount
      SET FailedAttempts = CASE WHEN LockedUntil < SYSUTCDATETIME() THEN 1 ELSE FailedAttempts + 1 END,
          LockedUntil = CASE WHEN FailedAttempts >= 4 THEN DATEADD(MINUTE, 15, SYSUTCDATETIME()) ELSE LockedUntil END
      WHERE ID=@accountId
    `);
    return false;
  }
  await pool.request().input('accountId', record.ID).query(`
    UPDATE dbo.TblEmployeePortalAccount SET FailedAttempts=0,LockedUntil=NULL WHERE ID=@accountId
  `);
  const claims: Claims = { empId: record.EmpID, accountId: record.ID, tenantId: record.TenantId, expires: Math.floor(Date.now() / 1000) + TTL_SECONDS };
  const data = Buffer.from(JSON.stringify(claims)).toString('base64url');
  (await cookies()).set(COOKIE, data + '.' + signature(data), {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/',
    maxAge: TTL_SECONDS,
  });
  return true;
}
export async function getEmployeePortalIdentity(): Promise<(Claims & { mustChangePassword: boolean; loginName: string }) | null> {
  const claims = parse((await cookies()).get(COOKIE)?.value);
  if (!claims) return null;
  const pool = await getPool();
  const result = await pool.request()
    .input('accountId', claims.accountId).input('empId', claims.empId).input('tenantId', claims.tenantId)
    .query(`SELECT a.ID, a.MustChangePassword, a.LoginName FROM dbo.TblEmployeePortalAccount a
      INNER JOIN dbo.TblEmp e ON e.EmpID=a.EmpID
      WHERE a.ID=@accountId AND a.EmpID=@empId AND a.TenantId=@tenantId
        AND e.TenantId=@tenantId AND a.IsEnabled=1 AND e.isActive=1`);
  return result.recordset.length ? { ...claims, mustChangePassword: Boolean(result.recordset[0].MustChangePassword), loginName: String(result.recordset[0].LoginName ?? '') } : null;
}
export async function changeEmployeePassword(currentPassword: string, nextPassword: string): Promise<boolean> {
  const identity = await getEmployeePortalIdentity();
  if (!identity || nextPassword.length < 12 || nextPassword.length > 128 || currentPassword === nextPassword) return false;
  const db = await getPool();
  const record = await db.request().input('accountId', identity.accountId)
    .input('empId', identity.empId).input('tenantId', identity.tenantId)
    .query(`SELECT PasswordHash FROM dbo.TblEmployeePortalAccount
      WHERE ID=@accountId AND EmpID=@empId AND TenantId=@tenantId AND IsEnabled=1`);
  const currentHash = record.recordset[0]?.PasswordHash as string | undefined;
  if (!(await verifyPassword(currentPassword, currentHash)).ok || !currentHash) return false;
  const hashed = await hashPassword(nextPassword);
  const changed = await db.request().input('accountId', identity.accountId)
    .input('empId', identity.empId).input('tenantId', identity.tenantId)
    .input('oldHash', currentHash).input('newHash', hashed)
    .query(`UPDATE dbo.TblEmployeePortalAccount
      SET PasswordHash=@newHash, MustChangePassword=0, UpdatedAt=SYSUTCDATETIME()
      WHERE ID=@accountId AND EmpID=@empId AND TenantId=@tenantId
        AND PasswordHash=@oldHash AND IsEnabled=1`);
  if (changed.rowsAffected[0] !== 1) return false;
  await logoutEmployee();
  return true;
}
export async function logoutEmployee(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
