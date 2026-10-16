import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getPool, sql } from '@/lib/db';
import { resolveStaffTenantContextForRequest } from '@/platform/tenant/tenantContext';
import { loadTenantPermissionActor } from '@/platform/access/tenantGrants';
import { canDrvo, DRVO_PERMISSIONS } from '@/platform/access/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeStaging() {
  return process.env.DRVO_STAGING_MODE === 'true' &&
    process.env.STAGING_SAFETY_ENFORCE === 'true' &&
    process.env.STAGING_SAFETY_DB_NAME === 'last132_agent' &&
    process.env.DB_NAME === 'last132_agent' &&
    process.env.DB_DATABASE === 'last132_agent' &&
    process.env.DB_USER === 'drvo_agent' &&
    process.env.DRVO_STAGING_OUTBOUND_DISABLED === 'true' &&
    process.env.DRVO_STAGING_WORKERS_DISABLED === 'true' &&
    process.env.DRVO_STAGING_CRON_DISABLED === 'true';
}

export async function POST(req: NextRequest) {
  if (!safeStaging()) return NextResponse.json({ error: 'STAGING_ONLY' }, { status: 503 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') || new URL(req.url).protocol.slice(0, -1);
  let sameOrigin = false;
  try {
    const o = origin ? new URL(origin) : null;
    sameOrigin = !!o && o.host === host && o.protocol === proto + ':' && !o.username && !o.password;
  } catch { /* fail closed */ }
  if (!sameOrigin || req.headers.get('x-drvo-role-intent') !== '1')
    return NextResponse.json({ error: 'CSRF_DENIED' }, { status: 403 });
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    return NextResponse.json({ error: 'JSON_REQUIRED' }, { status: 415 });
  if (Number(req.headers.get('content-length') || 0) > 1024)
    return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE' }, { status: 413 });

  let membershipId: string, roleId: string;
  try {
    const raw = await req.text();
    if (Buffer.byteLength(raw, 'utf8') > 1024) throw Error();
    const body: unknown = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error();
    const b = body as Record<string, unknown>;
    if (Object.keys(b).sort().join(',') !== 'membershipId,roleId' ||
        typeof b.membershipId !== 'string' || !uuid.test(b.membershipId) ||
        typeof b.roleId !== 'string' || !uuid.test(b.roleId)) throw Error();
    membershipId = b.membershipId;
    roleId = b.roleId;
  } catch { return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 }); }

  if (!session.TenantId || !session.MembershipId || !session.ActiveBranchID)
    return NextResponse.json({ error: 'TENANT_CONTEXT_REQUIRED' }, { status: 403 });
  const db = await getPool();
  const tx = new sql.Transaction(db);
  let begun = false;
  try {
    const identity = await db.request().query<{ name: string }>('SELECT DB_NAME() AS name');
    if (identity.recordset[0]?.name !== 'last132_agent') throw Error('WRONG_DATABASE');
    const context = await resolveStaffTenantContextForRequest({
      userId: session.UserID, activeBranchId: session.ActiveBranchID,
      preferredTenantId: session.TenantId,
    }, { executor: db });
    if (context.membershipId.toLowerCase() !== session.MembershipId.toLowerCase())
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    const actor = await loadTenantPermissionActor(context, { executor: db });
    if (!canDrvo(actor, context.tenantId, DRVO_PERMISSIONS.rolesManage) ||
        !canDrvo(actor, context.tenantId, DRVO_PERMISSIONS.membersManage))
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    if (membershipId.toLowerCase() === context.membershipId.toLowerCase())
      return NextResponse.json({ error: 'SELF_ROLE_CHANGE_DENIED' }, { status: 409 });

    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    begun = true;
    const tenant = context.tenantId;
    const freshActor = await loadTenantPermissionActor(context, { executor: tx });
    if (!canDrvo(freshActor, tenant, DRVO_PERMISSIONS.rolesManage) ||
        !canDrvo(freshActor, tenant, DRVO_PERMISSIONS.membersManage)) {
      await tx.rollback(); begun = false;
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }
    const target = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, tenant)
      .input('membershipId', sql.UniqueIdentifier, membershipId)
      .query<{ MembershipId: string }>(`
        SELECT m.MembershipId FROM dbo.TenantMembership m WITH (UPDLOCK, HOLDLOCK)
        JOIN dbo.Tenant t ON t.TenantId = m.TenantId AND t.Status = N'active'
        JOIN dbo.TblUser u ON u.UserID = m.LegacyUserId AND ISNULL(u.isDeleted, 0) = 0
        WHERE m.TenantId = @tenantId AND m.MembershipId = @membershipId`);
    if (target.recordset.length !== 1) {
      await tx.rollback(); begun = false;
      return NextResponse.json({ error: 'MEMBER_NOT_FOUND' }, { status: 404 });
    }
    const role = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, tenant)
      .input('roleId', sql.UniqueIdentifier, roleId)
      .query<{ RoleKey: string }>(`
        SELECT RoleKey FROM dbo.DrvoTenantRole WITH (UPDLOCK, HOLDLOCK)
        WHERE TenantId = @tenantId AND RoleId = @roleId AND IsActive = 1`);
    // Owner is provisioned during onboarding, never reassigned from this UI.
    if (role.recordset.length !== 1 || role.recordset[0].RoleKey === 'owner') {
      await tx.rollback(); begun = false;
      return NextResponse.json({ error: 'ROLE_NOT_ASSIGNABLE' }, { status: 403 });
    }
    const existingOwner = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, tenant)
      .input('membershipId', sql.UniqueIdentifier, membershipId)
      .query<{ count: number }>(`
        SELECT COUNT(*) AS count FROM dbo.DrvoTenantRoleAssignment a WITH (UPDLOCK, HOLDLOCK)
        JOIN dbo.DrvoTenantRole r ON r.RoleId = a.RoleId AND r.TenantId = a.TenantId
        WHERE a.TenantId = @tenantId AND a.MembershipId = @membershipId AND r.RoleKey = N'owner'`);
    if (existingOwner.recordset[0]?.count) {
      await tx.rollback(); begun = false;
      return NextResponse.json({ error: 'OWNER_PROTECTED' }, { status: 403 });
    }
    // Prevent a manager from assigning permissions they do not personally hold.
    const permissions = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, tenant)
      .input('roleId', sql.UniqueIdentifier, roleId)
      .query<{ PermissionKey: string }>(`
        SELECT PermissionKey FROM dbo.DrvoTenantRolePermission
        WHERE TenantId = @tenantId AND RoleId = @roleId`);
    if (permissions.recordset.some(p => !freshActor.grants.includes(p.PermissionKey))) {
      await tx.rollback(); begun = false;
      return NextResponse.json({ error: 'ROLE_EXCEEDS_ACTOR_GRANTS' }, { status: 403 });
    }
    // Replace only non-owner DRVO role assignments for this membership.
    await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, tenant)
      .input('membershipId', sql.UniqueIdentifier, membershipId)
      .query(`
        DELETE a FROM dbo.DrvoTenantRoleAssignment a
        WHERE a.TenantId = @tenantId AND a.MembershipId = @membershipId
          AND NOT EXISTS (
            SELECT 1 FROM dbo.DrvoTenantRole r
            WHERE r.TenantId = a.TenantId AND r.RoleId = a.RoleId AND r.RoleKey = N'owner'
          )`);
    await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, tenant)
      .input('membershipId', sql.UniqueIdentifier, membershipId)
      .input('roleId', sql.UniqueIdentifier, roleId)
      .query(`INSERT INTO dbo.DrvoTenantRoleAssignment (TenantId, MembershipId, RoleId)
        VALUES (@tenantId, @membershipId, @roleId)`);
    await tx.commit(); begun = false;
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (begun) { try { await tx.rollback(); } catch { /* preserve failure */ } }
    console.error('[drvo/tenant/roles] failed', error instanceof Error ? error.name : 'unknown');
    return NextResponse.json({ error: 'ROLE_UPDATE_FAILED' }, { status: 503 });
  }
}
