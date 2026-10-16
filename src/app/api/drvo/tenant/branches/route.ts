import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getPool, sql } from '@/lib/db';
import { assertCanAddBranch } from '@/platform/commercial/limits';
import { ensureLegacyIdMapInTransaction } from '@/platform/onboarding/legacyIdMap';
import { resolveStaffTenantContextForRequest } from '@/platform/tenant/tenantContext';
import { requireTenantPermission } from '@/platform/access/tenantGrants';
import { DRVO_PERMISSIONS } from '@/platform/access/permissions';
import { CommercialError } from '@/platform/commercial/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const errorResponse = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function POST(req: NextRequest) {
  if (process.env.DRVO_STAGING_MODE !== 'true' ||
    process.env.STAGING_SAFETY_ENFORCE !== 'true' ||
    process.env.STAGING_SAFETY_DB_NAME !== 'last132_agent' ||
    process.env.DB_NAME !== 'last132_agent' ||
    process.env.DB_DATABASE !== 'last132_agent' ||
    process.env.DB_USER !== 'drvo_agent' ||
    process.env.DRVO_STAGING_OUTBOUND_DISABLED !== 'true' ||
    process.env.DRVO_STAGING_WORKERS_DISABLED !== 'true' ||
    process.env.DRVO_STAGING_CRON_DISABLED !== 'true') return errorResponse('STAGING_ONLY', 503);
  const session = await getSession();
  if (!session) return errorResponse('UNAUTHENTICATED', 401);
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') || new URL(req.url).protocol.slice(0, -1);
  try {
    const parsed = origin ? new URL(origin) : null;
    if (!parsed || parsed.host !== host || parsed.protocol !== proto + ':' ||
      parsed.username || parsed.password || req.headers.get('x-drvo-branch-intent') !== '1')
      return errorResponse('CSRF_DENIED', 403);
  } catch { return errorResponse('CSRF_DENIED', 403); }
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    return errorResponse('JSON_REQUIRED', 415);
  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (Buffer.byteLength(raw, 'utf8') > 2048) return errorResponse('PAYLOAD_TOO_LARGE', 413);
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return errorResponse('INVALID_INPUT', 400);
    body = parsed as Record<string, unknown>;
  } catch { return errorResponse('INVALID_INPUT', 400); }
  if (Object.keys(body).sort().join(',') !== 'branchCode,branchName')
    return errorResponse('INVALID_FIELDS', 400);
  const code = typeof body.branchCode === 'string' ? body.branchCode.trim().toUpperCase() : '';
  const name = typeof body.branchName === 'string' ? body.branchName.trim() : '';
  if (!/^[A-Z][A-Z0-9_]{2,29}$/.test(code) || !name || name.length > 100)
    return errorResponse('INVALID_INPUT', 400);
  if (!session.TenantId || !session.MembershipId || !session.ActiveBranchID)
    return errorResponse('TENANT_CONTEXT_REQUIRED', 403);
  const db = await getPool();
  const tx = new sql.Transaction(db);
  let begun = false;
  try {
    const identity = await db.request().query<{ name: string }>('SELECT DB_NAME() AS name');
    if (identity.recordset[0]?.name !== 'last132_agent') return errorResponse('WRONG_DATABASE', 503);
    const context = await resolveStaffTenantContextForRequest({
      userId: session.UserID, activeBranchId: session.ActiveBranchID,
      preferredTenantId: session.TenantId,
    }, { executor: db });
    if (context.membershipId.toLowerCase() !== session.MembershipId.toLowerCase())
      return errorResponse('FORBIDDEN', 403);
    await requireTenantPermission(context, DRVO_PERMISSIONS.locationsManage, { executor: db });
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE); begun = true;
    const tenantId = context.tenantId;
    // Recheck permission inside the transaction to avoid using stale pre-transaction grants.
    await requireTenantPermission(context, DRVO_PERMISSIONS.locationsManage, { executor: tx });
    await assertCanAddBranch(tx, tenantId);
    const duplicate = await new sql.Request(tx)
      .input('code', sql.NVarChar(30), code)
      .input('name', sql.NVarChar(100), name)
      .query(`SELECT BranchID FROM dbo.TblBranch WITH (UPDLOCK, HOLDLOCK)
        WHERE BranchCode = @code OR BranchName = @name`);
    if (duplicate.recordset.length) {
      await tx.rollback(); begun = false; return errorResponse('BRANCH_ALREADY_EXISTS', 409);
    }
    const tenant = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .query<{ DefaultTimezone: string }>(`SELECT DefaultTimezone FROM dbo.Tenant WITH (UPDLOCK, HOLDLOCK)
        WHERE TenantId = @tenantId AND Status = N'active'`);
    if (tenant.recordset.length !== 1) throw Error('TENANT_NOT_ACTIVE');
    const timezone = tenant.recordset[0].DefaultTimezone || 'Africa/Cairo';
    const inserted = await new sql.Request(tx)
      .input('code', sql.NVarChar(30), code)
      .input('name', sql.NVarChar(100), name)
      .input('timezone', sql.NVarChar(64), timezone)
      .input('actor', sql.Int, session.UserID)
      .query<{ BranchID: number }>(`INSERT dbo.TblBranch (
        BranchCode, BranchName, TimeZone, BusinessDayCutoffTime,
        IsActive, LifecycleStatus, PublicBookingEnabled, ExternalNotificationsEnabled, CreatedByUserID
      ) OUTPUT INSERTED.BranchID
      VALUES (@code, @name, @timezone, CAST(N'04:00:00' AS time(0)),
        0, N'SETUP', 0, 0, @actor)`);
    const branchId = inserted.recordset[0]?.BranchID;
    if (!branchId) throw Error('BRANCH_INSERT_FAILED');
    const location = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('branchId', sql.Int, branchId)
      .input('code', sql.NVarChar(64), code)
      .input('timezone', sql.NVarChar(64), timezone)
      .query<{ LocationId: string }>(`INSERT dbo.Location
        (TenantId, LegacyBranchId, BranchCode, Timezone, Status)
        OUTPUT INSERTED.LocationId
        VALUES (@tenantId, @branchId, @code, @timezone, N'setup')`);
    const locationId = location.recordset[0]?.LocationId;
    if (!locationId) throw Error('LOCATION_INSERT_FAILED');
    await ensureLegacyIdMapInTransaction(tx, {
      tenantId, entityName: 'branch', legacyKey: String(branchId),
      authoritativeDrvoId: locationId,
    });
    await tx.commit(); begun = false;
    return NextResponse.json({ ok: true, branchId, locationId, status: 'SETUP' },
      { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (begun) { try { await tx.rollback(); } catch { /* best effort */ } }
    if (error instanceof CommercialError) return errorResponse(error.code, error.status);
    console.error('[drvo/tenant/branches] create failed', error instanceof Error ? error.name : 'unknown');
    return errorResponse('BRANCH_CREATE_FAILED', 503);
  }
}
