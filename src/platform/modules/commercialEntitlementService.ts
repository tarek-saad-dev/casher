import 'server-only';
import { Transaction } from 'mssql';
import { getPool, sql } from '@/lib/db';
import { canManageCommercialEntitlements } from './platformAuthority';
import { loadPlatformPrincipal } from './platformAuthorityRepository';
import {
  validateCommercialEntitlementCommand,
  type CommercialEntitlementCommand,
} from './commercialEntitlementCommand';

export class DrvoCommercialConflictError extends Error {
  readonly status = 409;
  constructor(code: string) { super(code); this.name = 'DrvoCommercialConflictError'; }
}

export type CommercialEntitlementResult = {
  requestId: string;
  tenantId: string;
  moduleKey: string;
  status: 'enabled' | 'suspended' | 'disabled';
  validUntilUtc: string | null;
  replayed: boolean;
};

type AuditRow = {
  TenantId: string;
  ModuleKey: string;
  Action: string;
  ActorUserId: number;
  NewStatus: CommercialEntitlementResult['status'];
  NewValidUntilUtc: Date | null;
};

function iso(value: Date | string | null | undefined): string | null {
  return value == null ? null : new Date(value).toISOString();
}

/**
 * Internal-only platform control-plane mutation. Not wired to any HTTP route.
 * authenticatedUserId MUST come from verified server-side authentication.
 * Serializes entitlement writes and idempotency on the same transaction;
 * rolls back the entitlement when audit insertion fails.
 */
export async function applyCommercialEntitlementCommand(
  authenticatedUserId: number,
  input: CommercialEntitlementCommand,
): Promise<CommercialEntitlementResult> {
  const command = validateCommercialEntitlementCommand(input);
  if (process.env.DRVO_STAGING_MODE === 'true' &&
      (process.env.STAGING_SAFETY_ENFORCE !== 'true' ||
       process.env.STAGING_SAFETY_DB_NAME !== 'last132_agent')) {
    throw new Error('STAGING_SAFETY_CONFIGURATION_REQUIRED');
  }
  const pool = await getPool();
  const tx = new Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const dbName = await tx.request().query<{ DatabaseName: string }>(
      'SELECT DB_NAME() AS DatabaseName',
    );
    if (process.env.DRVO_STAGING_MODE === 'true' &&
        dbName.recordset[0]?.DatabaseName !== 'last132_agent') {
      throw new Error('STAGING_DATABASE_MISMATCH');
    }

    const principal = await loadPlatformPrincipal(authenticatedUserId, { executor: tx });
    if (!canManageCommercialEntitlements(principal, authenticatedUserId)) {
      throw new Error('PLATFORM_ENTITLEMENT_MANAGE_DENIED');
    }

    // Exclusive application lock serializes all commercial changes and replays.
    // A fixed resource is conservative but avoids lock-order deadlocks.
    const lock = await tx.request().query<{ LockResult: number }>(`
      DECLARE @result INT;
      EXEC @result = sys.sp_getapplock
        @Resource = N'DRVO_COMMERCIAL_ENTITLEMENTS',
        @LockMode = 'Exclusive',
        @LockOwner = 'Transaction',
        @LockTimeout = 10000;
      SELECT @result AS LockResult;
    `);
    if ((lock.recordset[0]?.LockResult ?? -999) < 0) {
      throw new Error('COMMERCIAL_LOCK_UNAVAILABLE');
    }

    const existing = await tx.request()
      .input('requestId', sql.UniqueIdentifier, command.requestId)
      .query<AuditRow>(`
        SELECT TenantId, ModuleKey, Action, ActorUserId, NewStatus, NewValidUntilUtc
        FROM dbo.DrvoModuleEntitlementAudit WITH (UPDLOCK, HOLDLOCK)
        WHERE RequestId = @requestId;
      `);
    if (existing.recordset.length) {
      const audit = existing.recordset[0];
      if (String(audit.TenantId).toLowerCase() !== command.tenantId.toLowerCase() ||
          audit.ModuleKey !== command.moduleKey ||
          audit.Action !== command.action ||
          Number(audit.ActorUserId) !== authenticatedUserId ||
          (command.action === 'provision' || command.action === 'renew') &&
            iso(audit.NewValidUntilUtc) !== command.validUntilUtc) {
        throw new DrvoCommercialConflictError('IDEMPOTENCY_KEY_REUSED');
      }
      await tx.commit();
      return {
        requestId: command.requestId,
        tenantId: String(audit.TenantId),
        moduleKey: audit.ModuleKey,
        status: audit.NewStatus,
        validUntilUtc: iso(audit.NewValidUntilUtc),
        replayed: true,
      };
    }

    const tenant = await tx.request()
      .input('tenantId', sql.UniqueIdentifier, command.tenantId)
      .query<{ TenantId: string }>(`
        SELECT TenantId FROM dbo.Tenant WITH (UPDLOCK, HOLDLOCK)
        WHERE TenantId = @tenantId AND Status = N'active';
      `);
    if (!tenant.recordset.length) throw new Error('ACTIVE_TENANT_NOT_FOUND');

    const previous = await tx.request()
      .input('tenantId', sql.UniqueIdentifier, command.tenantId)
      .input('moduleKey', sql.NVarChar(64), command.moduleKey)
      .query<{ Status: string; ValidUntilUtc: Date | null }>(`
        SELECT Status, ValidUntilUtc FROM dbo.DrvoTenantModuleEntitlement
        WITH (UPDLOCK, HOLDLOCK)
        WHERE TenantId = @tenantId AND ModuleKey = @moduleKey;
      `);
    const old = previous.recordset[0] ?? null;
    if ((command.action === 'suspend' || command.action === 'renew' ||
         command.action === 'cancel') && !old) {
      throw new DrvoCommercialConflictError('ENTITLEMENT_NOT_FOUND');
    }
    if (command.action === 'renew' && old?.Status === 'disabled') {
      throw new DrvoCommercialConflictError('CANCELLED_ENTITLEMENT_REQUIRES_PROVISION');
    }

    // Suspend/cancel preserve expiry for audit fidelity and future review.
    const newExpiry = command.action === 'provision' || command.action === 'renew'
      ? command.validUntilUtc : iso(old?.ValidUntilUtc);
    await tx.request()
      .input('tenantId', sql.UniqueIdentifier, command.tenantId)
      .input('moduleKey', sql.NVarChar(64), command.moduleKey)
      .input('status', sql.NVarChar(16), command.targetStatus)
      .input('validUntil', sql.DateTime2(3), newExpiry ? new Date(newExpiry) : null)
      .query(`
        UPDATE dbo.DrvoTenantModuleEntitlement
        SET Status = @status, ValidUntilUtc = @validUntil,
            UpdatedAtUtc = SYSUTCDATETIME()
        WHERE TenantId = @tenantId AND ModuleKey = @moduleKey;
        IF @@ROWCOUNT = 0
          INSERT dbo.DrvoTenantModuleEntitlement
            (TenantId, ModuleKey, Status, ValidUntilUtc)
          VALUES (@tenantId, @moduleKey, @status, @validUntil);
      `);
    await tx.request()
      .input('requestId', sql.UniqueIdentifier, command.requestId)
      .input('tenantId', sql.UniqueIdentifier, command.tenantId)
      .input('moduleKey', sql.NVarChar(64), command.moduleKey)
      .input('action', sql.NVarChar(16), command.action)
      .input('actor', sql.Int, authenticatedUserId)
      .input('oldStatus', sql.NVarChar(16), old?.Status ?? null)
      .input('oldExpiry', sql.DateTime2(3), old?.ValidUntilUtc ?? null)
      .input('newStatus', sql.NVarChar(16), command.targetStatus)
      .input('newExpiry', sql.DateTime2(3), newExpiry ? new Date(newExpiry) : null)
      .query(`
        INSERT dbo.DrvoModuleEntitlementAudit
          (RequestId, TenantId, ModuleKey, Action, ActorUserId,
           PreviousStatus, PreviousValidUntilUtc, NewStatus, NewValidUntilUtc)
        VALUES
          (@requestId, @tenantId, @moduleKey, @action, @actor,
           @oldStatus, @oldExpiry, @newStatus, @newExpiry);
      `);
    await tx.commit();
    return {
      requestId: command.requestId,
      tenantId: command.tenantId,
      moduleKey: command.moduleKey,
      status: command.targetStatus,
      validUntilUtc: newExpiry,
      replayed: false,
    };
  } catch (error) {
    try { await tx.rollback(); } catch { /* transaction may have auto-rolled back */ }
    throw error;
  }
}
