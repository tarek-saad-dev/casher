import 'server-only';
import type { ConnectionPool, Transaction } from 'mssql';
import { getPool, sql } from '@/lib/db';

export type TenantSqlExecutor = ConnectionPool | Transaction;

export interface TenantLocationRef {
  locationId: string;
  legacyBranchId: number;
  branchCode: string;
  timezone: string;
}

/** Authoritative tenant identity for an authenticated staff request. */
export interface StaffTenantContext {
  kind: 'staff';
  tenantId: string;
  tenantCode: string;
  membershipId: string;
  userId: number;
  activeLocation: TenantLocationRef;
}

/** Tenant identity derived from an explicit public identity (branch code, booking code). */
export interface PublicTenantContext {
  kind: 'public';
  tenantId: string;
  tenantCode: string;
  location: TenantLocationRef;
}

/** Tenant identity carried by a claimed worker/outbox/webhook unit of work. */
export interface JobTenantContext {
  kind: 'job';
  tenantId: string;
  source: string;
}

export type TenantContext = StaffTenantContext | PublicTenantContext | JobTenantContext;

export interface TenantMembershipResolution {
  tenantId: string;
  tenantCode: string;
  membershipId: string;
}

export type TenantContextErrorCode =
  | 'TENANT_CONTEXT_UNRESOLVED'
  | 'TENANT_AMBIGUOUS'
  | 'TENANT_MEMBERSHIP_MISMATCH'
  | 'LOCATION_NOT_IN_TENANT'
  | 'USER_NOT_IN_TENANT';

/**
 * Fail-closed tenant resolution error. `publicCode` / `publicMessage` never reveal whether the
 * requested object exists in another tenant.
 */
/**
 * `message` is always the non-disclosing public text, so routes that echo `err.message` never
 * leak tenant / user / branch identifiers. Internal detail is kept in `detail` for logs.
 */
export class TenantContextError extends Error {
  readonly code: TenantContextErrorCode;
  readonly status: number;
  readonly publicCode: string;
  readonly publicMessage: string;
  readonly detail: string;

  constructor(code: TenantContextErrorCode, detail: string) {
    const notFound = code === 'LOCATION_NOT_IN_TENANT' || code === 'USER_NOT_IN_TENANT';
    const publicMessage = notFound ? 'غير موجود' : 'تعذر تحديد المنشأة لهذا الحساب';
    super(publicMessage);
    this.name = 'TenantContextError';
    this.code = code;
    this.detail = detail;
    this.publicMessage = publicMessage;
    this.status = notFound ? 404 : 403;
    this.publicCode = notFound ? 'NOT_FOUND' : 'TENANT_CONTEXT_REQUIRED';
  }
}

export function isTenantContextError(err: unknown): err is TenantContextError {
  return err instanceof TenantContextError;
}

async function executor(ex?: TenantSqlExecutor): Promise<TenantSqlExecutor> {
  return ex ?? (await getPool());
}

/**
 * user -> active TenantMembership -> active Tenant.
 * - preferredTenantId (signed session claim) must be one of the user's active memberships.
 * - otherwise exactly one active membership is required; zero or several fail closed.
 * There is no default/first-tenant fallback.
 */
export async function resolveUserTenantMembership(
  input: { userId: number; preferredTenantId?: string | null },
  opts: { executor?: TenantSqlExecutor } = {},
): Promise<TenantMembershipResolution> {
  const ex = await executor(opts.executor);
  const result = await ex
    .request()
    .input('userId', sql.Int, input.userId)
    .query(`
      SELECT m.MembershipId, m.TenantId, t.Code
      FROM dbo.TenantMembership m
      INNER JOIN dbo.Tenant t ON t.TenantId = m.TenantId
      WHERE m.LegacyUserId = @userId AND t.Status = N'active';
    `);
  const rows = (result.recordset as Array<{ MembershipId: string; TenantId: string; Code: string }>).map(
    (r) => ({
      tenantId: String(r.TenantId).toLowerCase(),
      tenantCode: String(r.Code),
      membershipId: String(r.MembershipId),
    }),
  );

  const preferred = input.preferredTenantId ? String(input.preferredTenantId).toLowerCase() : null;
  if (preferred) {
    const match = rows.find((r) => r.tenantId === preferred);
    if (!match) {
      throw new TenantContextError(
        'TENANT_MEMBERSHIP_MISMATCH',
        `User ${input.userId} has no active membership in session tenant`,
      );
    }
    return match;
  }
  if (rows.length === 1) return rows[0];
  if (rows.length === 0) {
    throw new TenantContextError(
      'TENANT_CONTEXT_UNRESOLVED',
      `User ${input.userId} has no active tenant membership`,
    );
  }
  throw new TenantContextError(
    'TENANT_AMBIGUOUS',
    `User ${input.userId} belongs to ${rows.length} tenants and no tenant was selected`,
  );
}

/** Branch/location is subordinate to TenantId: the legacy branch must map to an active Location of the tenant. */
export async function assertLegacyBranchInTenant(
  tenantId: string,
  legacyBranchId: number,
  opts: { executor?: TenantSqlExecutor } = {},
): Promise<TenantLocationRef> {
  if (!Number.isInteger(legacyBranchId) || legacyBranchId <= 0) {
    throw new TenantContextError('LOCATION_NOT_IN_TENANT', `Invalid branch ${legacyBranchId}`);
  }
  const ex = await executor(opts.executor);
  const result = await ex
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('branchId', sql.Int, legacyBranchId)
    .query(`
      SELECT LocationId, LegacyBranchId, BranchCode, Timezone
      FROM dbo.Location
      WHERE TenantId = @tenantId AND LegacyBranchId = @branchId AND Status = N'active';
    `);
  const row = result.recordset[0] as
    | { LocationId: string; LegacyBranchId: number; BranchCode: string; Timezone: string }
    | undefined;
  if (!row) {
    throw new TenantContextError(
      'LOCATION_NOT_IN_TENANT',
      `Branch ${legacyBranchId} is not an active location of tenant ${tenantId}`,
    );
  }
  return {
    locationId: String(row.LocationId),
    legacyBranchId: Number(row.LegacyBranchId),
    branchCode: String(row.BranchCode),
    timezone: String(row.Timezone),
  };
}

/** Legacy branch IDs that are active locations of the tenant. */
export async function listTenantLegacyBranchIds(
  tenantId: string,
  opts: { executor?: TenantSqlExecutor } = {},
): Promise<Set<number>> {
  const ex = await executor(opts.executor);
  const result = await ex
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      SELECT LegacyBranchId FROM dbo.Location
      WHERE TenantId = @tenantId AND Status = N'active';
    `);
  return new Set(
    (result.recordset as Array<{ LegacyBranchId: number }>).map((r) => Number(r.LegacyBranchId)),
  );
}

/** Legacy user must hold a membership in the tenant (cross-tenant user access fails non-disclosing). */
export async function assertLegacyUserInTenant(
  tenantId: string,
  legacyUserId: number,
  opts: { executor?: TenantSqlExecutor } = {},
): Promise<string> {
  const ex = await executor(opts.executor);
  const result = await ex
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('userId', sql.Int, legacyUserId)
    .query(`
      SELECT MembershipId FROM dbo.TenantMembership
      WHERE TenantId = @tenantId AND LegacyUserId = @userId;
    `);
  const row = result.recordset[0] as { MembershipId: string } | undefined;
  if (!row) {
    throw new TenantContextError(
      'USER_NOT_IN_TENANT',
      `User ${legacyUserId} is not a member of tenant ${tenantId}`,
    );
  }
  return String(row.MembershipId);
}

/** Canonical staff context: membership + tenant + active location, all fail closed. */
export async function resolveStaffTenantContextForRequest(
  input: { userId: number; activeBranchId: number; preferredTenantId?: string | null },
  opts: { executor?: TenantSqlExecutor } = {},
): Promise<StaffTenantContext> {
  const membership = await resolveUserTenantMembership(
    { userId: input.userId, preferredTenantId: input.preferredTenantId },
    opts,
  );
  const activeLocation = await assertLegacyBranchInTenant(
    membership.tenantId,
    input.activeBranchId,
    opts,
  );
  return {
    kind: 'staff',
    tenantId: membership.tenantId,
    tenantCode: membership.tenantCode,
    membershipId: membership.membershipId,
    userId: input.userId,
    activeLocation,
  };
}

/**
 * Public tenant derivation from an explicit public identity. The branch must map to exactly one
 * active Location of an active Tenant; unmapped or multiply-mapped branches fail closed.
 */
export async function resolvePublicTenantContext(
  identity: { branchCode: string } | { legacyBranchId: number },
  opts: { executor?: TenantSqlExecutor } = {},
): Promise<PublicTenantContext> {
  const ex = await executor(opts.executor);
  const req = ex.request();
  let where: string;
  if ('branchCode' in identity) {
    const code = String(identity.branchCode ?? '').trim();
    if (!code) throw new TenantContextError('TENANT_CONTEXT_UNRESOLVED', 'Missing public branch code');
    req.input('branchCode', sql.NVarChar(64), code);
    where = 'l.BranchCode = @branchCode';
  } else {
    if (!Number.isInteger(identity.legacyBranchId) || identity.legacyBranchId <= 0) {
      throw new TenantContextError('TENANT_CONTEXT_UNRESOLVED', 'Invalid public branch');
    }
    req.input('branchId', sql.Int, identity.legacyBranchId);
    where = 'l.LegacyBranchId = @branchId';
  }
  const result = await req.query(`
    SELECT l.TenantId, t.Code, l.LocationId, l.LegacyBranchId, l.BranchCode, l.Timezone
    FROM dbo.Location l
    INNER JOIN dbo.Tenant t ON t.TenantId = l.TenantId
    WHERE ${where} AND l.Status = N'active' AND t.Status = N'active';
  `);
  const rows = result.recordset as Array<{
    TenantId: string;
    Code: string;
    LocationId: string;
    LegacyBranchId: number;
    BranchCode: string;
    Timezone: string;
  }>;
  if (rows.length === 0) {
    throw new TenantContextError('TENANT_CONTEXT_UNRESOLVED', 'Public branch is not mapped to a tenant');
  }
  if (new Set(rows.map((r) => String(r.TenantId).toLowerCase())).size > 1) {
    throw new TenantContextError('TENANT_AMBIGUOUS', 'Public branch is mapped to more than one tenant');
  }
  const row = rows[0];
  return {
    kind: 'public',
    tenantId: String(row.TenantId).toLowerCase(),
    tenantCode: String(row.Code),
    location: {
      locationId: String(row.LocationId),
      legacyBranchId: Number(row.LegacyBranchId),
      branchCode: String(row.BranchCode),
      timezone: String(row.Timezone),
    },
  };
}

/** Worker/outbox/webhook context: TenantId always comes from the claimed row, never a process default. */
export function buildJobTenantContext(tenantId: string | null | undefined, source: string): JobTenantContext {
  const id = String(tenantId ?? '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new TenantContextError('TENANT_CONTEXT_UNRESOLVED', `Job ${source} has no TenantId`);
  }
  return { kind: 'job', tenantId: id.toLowerCase(), source };
}

/** Composition roots: an actor without an authoritative tenant is rejected, never defaulted. */
export function requireActorTenantId(actor: { tenantId: string | null | undefined }, where: string): string {
  if (!actor.tenantId) {
    throw new TenantContextError('TENANT_CONTEXT_UNRESOLVED', `${where}: actor has no tenant context`);
  }
  return actor.tenantId;
}
