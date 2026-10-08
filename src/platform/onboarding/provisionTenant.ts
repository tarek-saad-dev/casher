import 'server-only';
import type { Transaction } from 'mssql';
import { getPool, sql } from '@/lib/db';
import { assertBranchIdentityAvailable } from '@/lib/branch/bootstrap';
import { resolveTenantComposition } from '@/platform/apps/compositionResolver';
import { applyCompositionInTransaction } from '@/platform/apps/tenantApps';
import { assertCanAddBranch, assertCanAddUser } from '@/platform/commercial/limits';
import {
  createOnboardingSubscriptionInTransaction,
  resolveOnboardingPlan,
} from '@/platform/commercial/subscriptionService';
import { DEFAULT_ONBOARDING_PLAN_CODE } from '@/platform/commercial/types';
import { seedTenantMasterData } from '@/platform/masterData/seedTenantMasterData';
import { publishPlatformOutboxEvent } from '@/platform/outbox/publisher';
import { tenantLockResource } from '@/platform/tenant/tenantLockResource';
import { TenantOnboardingError } from './errors';
import { ensureLegacyIdMapInTransaction } from './legacyIdMap';
import { evaluateTenantReadiness } from './tenantReadiness';
import type {
  ProvisionTenantActor,
  ProvisionTenantInput,
  ProvisionTenantResult,
} from './types';
import {
  assertValidTenantCode,
  normalizeBranchCode,
  normalizeTenantCode,
} from './validation';

function toSqlTime(value: string | null | undefined): string | null {
  if (value == null || !String(value).trim()) return null;
  const v = String(value).trim();
  if (/^\d{2}:\d{2}$/.test(v)) return `${v}:00`;
  if (/^\d{2}:\d{2}:\d{2}$/.test(v)) return v;
  throw new TenantOnboardingError('OWNER_FIELDS_INVALID', `Invalid time value: ${value}`);
}

async function assertTenantCodeAvailable(tx: Transaction, tenantCode: string): Promise<void> {
  const existing = await new sql.Request(tx)
    .input('code', sql.NVarChar(64), tenantCode)
    .query(`
      SELECT TenantId FROM dbo.Tenant WITH (UPDLOCK, HOLDLOCK)
      WHERE Code = @code;
    `);
  if (existing.recordset.length) {
    throw new TenantOnboardingError(
      'TENANT_CODE_CONFLICT',
      `Tenant code already exists: ${tenantCode}`,
      409,
    );
  }
}

async function assertOwnerLoginAvailable(tx: Transaction, loginName: string): Promise<void> {
  const dup = await new sql.Request(tx)
    .input('loginName', sql.NVarChar(50), loginName)
    .query(`
      SELECT UserID FROM dbo.TblUser WITH (UPDLOCK, HOLDLOCK)
      WHERE loginName = @loginName AND ISNULL(isDeleted, 0) = 0;
    `);
  if (dup.recordset.length) {
    throw new TenantOnboardingError(
      'OWNER_USERNAME_CONFLICT',
      `Owner login name already exists: ${loginName}`,
      409,
    );
  }
}

async function createBranchInTransaction(
  tx: Transaction,
  input: {
    branchCode: string;
    branchName: string;
    address?: string | null;
    phone?: string | null;
    timeZone: string;
    defaultOpenTime?: string | null;
    defaultCloseTime?: string | null;
    createdByUserId: number;
  },
): Promise<{ branchId: number; branchCode: string }> {
  const openT = toSqlTime(input.defaultOpenTime);
  const closeT = toSqlTime(input.defaultCloseTime);

  const result = await new sql.Request(tx)
    .input('code', sql.NVarChar(30), input.branchCode)
    .input('name', sql.NVarChar(100), input.branchName)
    .input('address', sql.NVarChar(250), input.address?.trim() || null)
    .input('phone', sql.NVarChar(30), input.phone?.trim() || null)
    .input('tz', sql.NVarChar(64), input.timeZone)
    .input('openT', sql.NVarChar(8), openT)
    .input('closeT', sql.NVarChar(8), closeT)
    .input(
      'createdBy',
      sql.Int,
      input.createdByUserId > 0 ? input.createdByUserId : null,
    )
    .query(`
      INSERT INTO dbo.TblBranch (
        BranchCode, BranchName, ShortName, Address, Phone,
        TimeZone, BusinessDayCutoffTime, DefaultOpenTime, DefaultCloseTime,
        IsActive, LifecycleStatus, PublicBookingEnabled, ExternalNotificationsEnabled,
        CreatedByUserID
      )
      OUTPUT INSERTED.BranchID, INSERTED.BranchCode
      VALUES (
        @code, @name, NULL, @address, @phone,
        @tz, CAST(N'04:00:00' AS time(0)),
        CASE WHEN @openT IS NULL THEN NULL ELSE CAST(@openT AS time(0)) END,
        CASE WHEN @closeT IS NULL THEN NULL ELSE CAST(@closeT AS time(0)) END,
        0, N'SETUP', 0, 0, @createdBy
      )
    `);

  const row = result.recordset[0] as { BranchID: number; BranchCode: string };
  return { branchId: Number(row.BranchID), branchCode: String(row.BranchCode) };
}

async function createOwnerUserInTransaction(
  tx: Transaction,
  input: {
    userName: string;
    loginName: string;
    password: string;
    userLevel: string;
    branchId: number;
    actorUserId: number;
  },
): Promise<number> {
  const inserted = await new sql.Request(tx)
    .input('userName', sql.NVarChar(50), input.userName)
    .input('loginName', sql.NVarChar(50), input.loginName)
    .input('password', sql.NVarChar(50), input.password)
    .input('userLevel', sql.NVarChar(20), input.userLevel)
    .query(`
      INSERT INTO dbo.TblUser (UserName, loginName, Password, UserLevel, ShiftID, CardNO, isDeleted)
      OUTPUT INSERTED.UserID
      VALUES (@userName, @loginName, @password, @userLevel, 1, N'', 0)
    `);
  const userId = Number((inserted.recordset[0] as { UserID: number }).UserID);

  await new sql.Request(tx)
    .input('userId', sql.Int, userId)
    .input('branchId', sql.Int, input.branchId)
    .input(
      'grantedBy',
      sql.Int,
      input.actorUserId > 0 ? input.actorUserId : null,
    )
    .query(`
      INSERT INTO dbo.TblUserBranchAccess (
        UserID, BranchID, IsDefault, CanOperate, CanViewReports, CanSwitch,
        IsActive, ValidFrom, ValidTo, GrantedByUserID, GrantReason
      )
      VALUES (
        @userId, @branchId, 1, 1, 1, 1,
        1, SYSUTCDATETIME(), NULL, @grantedBy, N'tenant-onboarding-owner'
      )
    `);

  return userId;
}

async function seedQueueSettingsInTransaction(
  tx: Transaction,
  branchId: number,
  branchName: string,
  timeZone: string,
): Promise<void> {
  await new sql.Request(tx)
    .input('branchId', sql.Int, branchId)
    .input('salonName', sql.NVarChar(100), branchName)
    .input('timezone', sql.NVarChar(64), timeZone)
    .query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.QueueBookingSettings WHERE BranchID = @branchId)
      INSERT INTO dbo.QueueBookingSettings (
        BranchID, SalonName, Timezone, Currency, BookingEnabled,
        AllowSpecificBarber, AllowNearestBarber, DefaultMode,
        SlotIntervalMinutes, MaxBookingDaysAhead, MinNoticeMinutes,
        DefaultServiceDurationMinutes, DefaultServiceMinutes
      )
      VALUES (
        @branchId, @salonName, @timezone, N'EGP', 0,
        1, 1, N'nearest',
        15, 14, 30,
        30, 30
      )
    `);
}

/**
 * Platform-owned tenant onboarding. Atomic within one SQL transaction.
 * Does not copy CUT financial/transactional data or GLEEM templates.
 */
export async function provisionTenant(
  input: ProvisionTenantInput,
  actor: ProvisionTenantActor,
): Promise<ProvisionTenantResult> {
  const tenantCode = assertValidTenantCode(input.tenantCode);
  const branchCode = normalizeBranchCode(input.firstBranchCode);
  const pack = input.industryPack;
  const composition = resolveTenantComposition(pack, input.appCustomizations ?? {});
  const planCode =
    (input.planCode ?? DEFAULT_ONBOARDING_PLAN_CODE).trim().toLowerCase() ||
    DEFAULT_ONBOARDING_PLAN_CODE;
  const subscriptionStatus = input.subscriptionStatus ?? 'trial';
  const ownerLoginName = input.ownerLoginName.trim();
  const ownerUserName = input.ownerUserName.trim();
  const ownerPassword = input.ownerPassword;
  const ownerUserLevel = input.ownerUserLevel?.trim() || 'admin';
  const defaultTimezone = input.defaultTimezone.trim() || 'Africa/Cairo';

  if (!ownerLoginName || !ownerUserName || !ownerPassword) {
    throw new TenantOnboardingError(
      'OWNER_FIELDS_INVALID',
      'Owner username, login name, and password are required.',
    );
  }
  if (!input.tenantDisplayName.trim()) {
    throw new TenantOnboardingError('OWNER_FIELDS_INVALID', 'Tenant display name is required.');
  }
  if (!branchCode || !input.firstBranchName.trim()) {
    throw new TenantOnboardingError('OWNER_FIELDS_INVALID', 'First branch code and name are required.');
  }

  await assertBranchIdentityAvailable({
    branchCode,
    branchName: input.firstBranchName.trim(),
  });

  const pool = await getPool();

  if (actor.actorUserId > 0) {
    const actorRow = await pool
      .request()
      .input('userId', sql.Int, actor.actorUserId)
      .query(`
        SELECT UserID FROM dbo.TblUser
        WHERE UserID = @userId AND ISNULL(isDeleted, 0) = 0;
      `);
    if (!actorRow.recordset.length) {
      throw new TenantOnboardingError(
        'OWNER_FIELDS_INVALID',
        `Provisioning actor user ${actor.actorUserId} was not found.`,
        400,
      );
    }
  }
  const tx = new sql.Transaction(pool);
  await tx.begin();

  try {
    const now = new Date();
    await assertTenantCodeAvailable(tx, tenantCode);
    await assertOwnerLoginAvailable(tx, ownerLoginName);
    const plan = await resolveOnboardingPlan(tx, planCode);

    const tenantInsert = await new sql.Request(tx)
      .input('code', sql.NVarChar(64), tenantCode)
      .input('name', sql.NVarChar(256), input.tenantDisplayName.trim())
      .input('tz', sql.NVarChar(64), defaultTimezone)
      .query(`
        INSERT INTO dbo.Tenant (Code, Name, Status, DefaultTimezone)
        OUTPUT INSERTED.TenantId AS tenantId
        VALUES (@code, @name, N'active', @tz);
      `);
    const tenantId = String((tenantInsert.recordset[0] as { tenantId: string }).tenantId);

    const subscription = await createOnboardingSubscriptionInTransaction(tx, {
      tenantId,
      plan,
      status: subscriptionStatus,
      now,
      actor: { actorUserId: actor.actorUserId },
    });

    await assertCanAddBranch(tx, tenantId, now);
    const branch = await createBranchInTransaction(tx, {
      branchCode,
      branchName: input.firstBranchName.trim(),
      address: input.branchAddress,
      phone: input.branchPhone,
      timeZone: defaultTimezone,
      defaultOpenTime: input.branchDefaultOpenTime,
      defaultCloseTime: input.branchDefaultCloseTime,
      createdByUserId: actor.actorUserId,
    });

    await seedQueueSettingsInTransaction(
      tx,
      branch.branchId,
      input.firstBranchName.trim(),
      defaultTimezone,
    );

    const locationInsert = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('legacyBranchId', sql.Int, branch.branchId)
      .input('branchCode', sql.NVarChar(64), branch.branchCode)
      .input('tz', sql.NVarChar(64), defaultTimezone)
      .query(`
        INSERT INTO dbo.Location (TenantId, LegacyBranchId, BranchCode, Timezone, Status)
        OUTPUT INSERTED.LocationId AS locationId
        VALUES (@tenantId, @legacyBranchId, @branchCode, @tz, N'active');
      `);
    const locationId = String(
      (locationInsert.recordset[0] as { locationId: string }).locationId,
    );

    await ensureLegacyIdMapInTransaction(tx, {
      tenantId,
      entityName: 'branch',
      legacyKey: String(branch.branchId),
      authoritativeDrvoId: locationId,
    });

    await assertCanAddUser(tx, tenantId, now);
    const ownerUserId = await createOwnerUserInTransaction(tx, {
      userName: ownerUserName,
      loginName: ownerLoginName,
      password: ownerPassword,
      userLevel: ownerUserLevel,
      branchId: branch.branchId,
      actorUserId: actor.actorUserId,
    });

    const membershipInsert = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('legacyUserId', sql.Int, ownerUserId)
      .query(`
        INSERT INTO dbo.TenantMembership (TenantId, LegacyUserId)
        OUTPUT INSERTED.MembershipId AS membershipId
        VALUES (@tenantId, @legacyUserId);
      `);
    const membershipId = String(
      (membershipInsert.recordset[0] as { membershipId: string }).membershipId,
    );

    await ensureLegacyIdMapInTransaction(tx, {
      tenantId,
      entityName: 'staff_user',
      legacyKey: String(ownerUserId),
      authoritativeDrvoId: membershipId,
    });

    await applyCompositionInTransaction(tx, {
      tenantId,
      pack,
      composition,
      now,
      actor: { actorUserId: actor.actorUserId },
      reason: 'onboarding',
    });

    await seedTenantMasterData(tx, tenantId);

    await publishPlatformOutboxEvent(tx, {
      tenantId,
      aggregateType: 'tenant',
      aggregateId: tenantId,
      eventType: 'tenant.provisioned',
      payload: JSON.stringify({
        tenantCode,
        branchCode: branch.branchCode,
        legacyBranchId: branch.branchId,
        ownerUserId,
        ownerLoginName,
        industryPackCode: pack.packCode,
        apps: composition.apps,
        planCode: plan.planCode,
        subscriptionStatus: subscription.status,
        actorUserId: actor.actorUserId,
        lockResource: tenantLockResource(tenantId, ['onboarding', tenantCode]),
      }),
      idempotencyKey: `tenant-provision:${tenantCode}`,
      correlationId: `tenant-onboarding:${tenantCode}`,
    });

    await tx.commit();

    const readiness = await evaluateTenantReadiness(tenantId, pool, {
      resolvePack: (code) => (code === pack.packCode ? pack : null),
    });
    return {
      tenantId,
      tenantCode,
      locationId,
      membershipId,
      legacyBranchId: branch.branchId,
      legacyUserId: ownerUserId,
      branchCode: branch.branchCode,
      ownerLoginName,
      industryPackCode: pack.packCode,
      apps: composition.apps,
      planCode: plan.planCode,
      subscriptionStatus: subscription.status,
      trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
      readiness,
    };
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      /* ignore */
    }
    throw err;
  }
}

export async function listTenants(): Promise<
  Array<{
    tenantId: string;
    code: string;
    name: string;
    status: string;
    defaultTimezone: string;
    locationCount: number;
    createdAt: string;
  }>
> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT
      t.TenantId,
      t.Code,
      t.Name,
      t.Status,
      t.DefaultTimezone,
      t.CreatedAt,
      (SELECT COUNT(*) FROM dbo.Location l WHERE l.TenantId = t.TenantId) AS LocationCount
    FROM dbo.Tenant t WITH (NOLOCK)
    ORDER BY t.CreatedAt;
  `);

  return (result.recordset as Array<Record<string, unknown>>).map((row) => ({
    tenantId: String(row.TenantId),
    code: String(row.Code),
    name: String(row.Name),
    status: String(row.Status),
    defaultTimezone: String(row.DefaultTimezone),
    locationCount: Number(row.LocationCount),
    createdAt:
      row.CreatedAt instanceof Date
        ? row.CreatedAt.toISOString()
        : String(row.CreatedAt),
  }));
}

export async function getTenantByCode(tenantCode: string) {
  const pool = await getPool();
  const normalized = normalizeTenantCode(tenantCode);
  const result = await pool
    .request()
    .input('code', sql.NVarChar(64), normalized)
    .query(`
      SELECT TenantId, Code, Name, Status, DefaultTimezone, CreatedAt
      FROM dbo.Tenant WITH (NOLOCK)
      WHERE Code = @code;
    `);
  if (!result.recordset.length) return null;
  const row = result.recordset[0] as Record<string, unknown>;
  return {
    tenantId: String(row.TenantId),
    code: String(row.Code),
    name: String(row.Name),
    status: String(row.Status),
    defaultTimezone: String(row.DefaultTimezone),
    createdAt:
      row.CreatedAt instanceof Date
        ? row.CreatedAt.toISOString()
        : String(row.CreatedAt),
  };
}
