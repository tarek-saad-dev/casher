import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getPool, sql } from '@/lib/db';
import { hashPassword } from '@/lib/auth/passwordHash';
import { assertCanAddUser } from '@/platform/commercial/limits';
import { ensureLegacyIdMapInTransaction } from '@/platform/onboarding/legacyIdMap';
import { resolveStaffTenantContextForRequest } from '@/platform/tenant/tenantContext';
import { loadTenantPermissionActor } from '@/platform/access/tenantGrants';
import { canDrvo, DRVO_PERMISSIONS } from '@/platform/access/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const loginPattern = /^[a-zA-Z][a-zA-Z0-9_.-]{3,48}$/;
const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function POST(req: NextRequest) {
  if (process.env.DRVO_STAGING_MODE !== 'true' ||
      process.env.STAGING_SAFETY_ENFORCE !== 'true' ||
      process.env.STAGING_SAFETY_DB_NAME !== 'last132_agent' ||
      process.env.DB_NAME !== 'last132_agent' ||
      process.env.DB_DATABASE !== 'last132_agent' ||
      process.env.DB_USER !== 'drvo_agent' ||
      process.env.DRVO_STAGING_OUTBOUND_DISABLED !== 'true' ||
      process.env.DRVO_STAGING_WORKERS_DISABLED !== 'true' ||
      process.env.DRVO_STAGING_CRON_DISABLED !== 'true') return fail('STAGING_ONLY', 503);
  const session = await getSession();
  if (!session) return fail('UNAUTHENTICATED', 401);
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  const protocol = req.headers.get('x-forwarded-proto') || new URL(req.url).protocol.slice(0, -1);
  try {
    if (!origin || new URL(origin).host !== host || new URL(origin).protocol !== protocol + ':' ||
      req.headers.get('x-drvo-member-intent') !== '1') return fail('CSRF_DENIED', 403);
  } catch { return fail('CSRF_DENIED', 403); }
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    return fail('JSON_REQUIRED', 415);
  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (Buffer.byteLength(raw, 'utf8') > 2048) return fail('PAYLOAD_TOO_LARGE', 413);
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail('INVALID_INPUT', 400);
    body = parsed as Record<string, unknown>;
  } catch { return fail('INVALID_INPUT', 400); }
  if (Object.keys(body).sort().join(',') !== 'branchId,loginName,password,roleId,userName')
    return fail('INVALID_FIELDS', 400);
  const name = typeof body.userName === 'string' ? body.userName.trim() : '';
  const login = typeof body.loginName === 'string' ? body.loginName.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const branchId = body.branchId;
  const roleId = body.roleId;
  if (!name || name.length > 50 || !loginPattern.test(login) ||
      password.length < 12 || password.length > 100 ||
      !Number.isInteger(branchId) || Number(branchId) <= 0 ||
      typeof roleId !== 'string' || !uuid.test(roleId)) return fail('INVALID_INPUT', 400);
  if (!session.TenantId || !session.MembershipId || !session.ActiveBranchID)
    return fail('TENANT_CONTEXT_REQUIRED', 403);
  const db = await getPool();
  const tx = new sql.Transaction(db);
  let begun = false;
  try {
    const identity = await db.request().query<{ name: string }>('SELECT DB_NAME() AS name');
    if (identity.recordset[0]?.name !== 'last132_agent') return fail('WRONG_DATABASE', 503);
    const context = await resolveStaffTenantContextForRequest({
      userId: session.UserID, activeBranchId: session.ActiveBranchID,
      preferredTenantId: session.TenantId,
    }, { executor: db });
    if (context.membershipId.toLowerCase() !== session.MembershipId.toLowerCase()) return fail('FORBIDDEN', 403);
    const actor = await loadTenantPermissionActor(context, { executor: db });
    if (!canDrvo(actor, context.tenantId, DRVO_PERMISSIONS.membersInvite) ||
        !canDrvo(actor, context.tenantId, DRVO_PERMISSIONS.membersManage)) return fail('FORBIDDEN', 403);
    const passwordHash = await hashPassword(password);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    begun = true;
    const tenantId = context.tenantId;
    await assertCanAddUser(tx, tenantId);
    const branch = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('branchId', sql.Int, Number(branchId))
      .query(`SELECT LocationId FROM dbo.Location WITH (UPDLOCK, HOLDLOCK)
        WHERE TenantId = @tenantId AND LegacyBranchId = @branchId AND Status = N'active'`);
    if (branch.recordset.length !== 1) {
      await tx.rollback(); begun = false; return fail('BRANCH_NOT_FOUND', 404);
    }
    const role = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('roleId', sql.UniqueIdentifier, roleId)
      .query<{ RoleKey: string }>(`SELECT RoleKey FROM dbo.DrvoTenantRole
        WHERE TenantId = @tenantId AND RoleId = @roleId AND IsActive = 1`);
    if (role.recordset.length !== 1 || role.recordset[0].RoleKey === 'owner') {
      await tx.rollback(); begun = false; return fail('ROLE_NOT_ASSIGNABLE', 403);
    }
    const grants = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('roleId', sql.UniqueIdentifier, roleId)
      .query<{ PermissionKey: string }>(`SELECT PermissionKey FROM dbo.DrvoTenantRolePermission
        WHERE TenantId = @tenantId AND RoleId = @roleId`);
    if (grants.recordset.some(p => !actor.grants.includes(p.PermissionKey))) {
      await tx.rollback(); begun = false; return fail('ROLE_EXCEEDS_ACTOR_GRANTS', 403);
    }
    const existing = await new sql.Request(tx).input('login', sql.NVarChar(50), login)
      .query(`SELECT UserID FROM dbo.TblUser WITH (UPDLOCK, HOLDLOCK)
        WHERE loginName = @login`);
    if (existing.recordset.length) {
      await tx.rollback(); begun = false; return fail('LOGIN_ALREADY_EXISTS', 409);
    }
    // Never create a legacy administrator; DRVO permissions are the only tenant grants.
    const inserted = await new sql.Request(tx)
      .input('name', sql.NVarChar(50), name)
      .input('login', sql.NVarChar(50), login)
      .input('hash', sql.NVarChar(50), passwordHash)
      .query<{ UserID: number }>(`INSERT dbo.TblUser
        (UserName, loginName, Password, UserLevel, ShiftID, CardNO, isDeleted)
        OUTPUT INSERTED.UserID VALUES (@name, @login, @hash, N'employee', 1, N'', 0)`);
    const userId = inserted.recordset[0]?.UserID;
    if (!userId) throw Error('USER_INSERT_FAILED');
    await new sql.Request(tx)
      .input('userId', sql.Int, userId)
      .input('branchId', sql.Int, Number(branchId))
      .input('actor', sql.Int, session.UserID)
      .query(`INSERT dbo.TblUserBranchAccess
        (UserID, BranchID, IsDefault, CanOperate, CanViewReports, CanSwitch,
         IsActive, ValidFrom, ValidTo, GrantedByUserID, GrantReason)
        VALUES (@userId, @branchId, 1, 0, 0, 0, 1, SYSUTCDATETIME(), NULL, @actor, N'drvo-tenant-member')`);
    const membership = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('userId', sql.Int, userId)
      .query<{ MembershipId: string }>(`INSERT dbo.TenantMembership (TenantId, LegacyUserId)
        OUTPUT INSERTED.MembershipId VALUES (@tenantId, @userId)`);
    const membershipId = membership.recordset[0]?.MembershipId;
    if (!membershipId) throw Error('MEMBERSHIP_INSERT_FAILED');
    await ensureLegacyIdMapInTransaction(tx, {
      tenantId, entityName: 'staff_user', legacyKey: String(userId),
      authoritativeDrvoId: membershipId,
    });
    await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('membershipId', sql.UniqueIdentifier, membershipId)
      .input('roleId', sql.UniqueIdentifier, roleId)
      .query(`INSERT dbo.DrvoTenantRoleAssignment (TenantId, MembershipId, RoleId)
        VALUES (@tenantId, @membershipId, @roleId)`);
    await tx.commit(); begun = false;
    return NextResponse.json({ ok: true, membershipId }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (begun) { try { await tx.rollback(); } catch { /* best effort */ } }
    console.error('[drvo/tenant/members] create failed', error instanceof Error ? error.name : 'unknown');
    return fail('MEMBER_CREATE_FAILED', 503);
  }
}
