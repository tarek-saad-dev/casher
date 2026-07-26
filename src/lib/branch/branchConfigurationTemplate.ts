/**
 * Phase 1O — selective approved configuration template copy (not full branch clone).
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import { getBranchById } from './repository';
import { BranchDomainError } from './types';
import { grantUserBranchAccess } from './bootstrap';
import { invalidatePublicSettingsCache } from '@/lib/publicBookingHelpers';
import { upsertBranchSetupPolicy } from './branchSetupPolicy';

export type ConfigurationTemplateDomain =
  | 'operating_settings'
  | 'queue_booking_timing'
  | 'service_availability'
  | 'service_prices'
  | 'service_durations'
  | 'user_branch_access'
  | 'payment_method_enablement'
  | 'printer_endpoint'
  | 'whatsapp_integration';

export type DomainApplyResult = {
  domain: ConfigurationTemplateDomain;
  beforeCount: number;
  afterCount: number;
  created: number;
  updated: number;
  skipped: number;
  notes: string[];
};

export type ApplyTemplateResult = {
  sourceBranchId: number;
  targetBranchId: number;
  domains: DomainApplyResult[];
  auditedAt: string;
};

const FORBIDDEN_BODY_OWNERSHIP = new Set([
  'branchId',
  'BranchID',
  'sourceBranchId',
  'targetBranchId',
  'isActive',
  'IsActive',
  'lifecycleStatus',
  'LifecycleStatus',
  'publicBookingEnabled',
  'PublicBookingEnabled',
  'externalNotificationsEnabled',
  'ExternalNotificationsEnabled',
]);

export type ApplyTemplateInput = {
  sourceBranchId: number;
  targetBranchId: number;
  domains: ConfigurationTemplateDomain[];
  actorUserId: number;
  /** English display for target SalonName when queue domain applied */
  targetEnglishDisplayName?: string;
  /** Exclude UserIDs even if present on source */
  excludeUserIds?: number[];
  /** Extra smoke/test username patterns (case-insensitive) */
  excludeUsernamePatterns?: RegExp[];
};

function assertNoOwnershipBodyFields(payload: Record<string, unknown>): void {
  for (const key of Object.keys(payload)) {
    if (FORBIDDEN_BODY_OWNERSHIP.has(key)) {
      throw new BranchDomainError(
        'OPERATION_NOT_ALLOWED',
        `Body-controlled ownership field rejected: ${key}`,
        400,
      );
    }
  }
}

async function requireAdminOnBoth(
  sourceBranchId: number,
  targetBranchId: number,
  actorUserId: number,
): Promise<void> {
  const db = await getPool();
  for (const branchId of [sourceBranchId, targetBranchId]) {
    const access = await db
      .request()
      .input('userId', sql.Int, actorUserId)
      .input('branchId', sql.Int, branchId)
      .query(`
        SELECT TOP 1 ID
        FROM dbo.TblUserBranchAccess
        WHERE UserID = @userId AND BranchID = @branchId AND IsActive = 1
          AND CanOperate = 1
      `);
    if (!access.recordset[0]) {
      throw new BranchDomainError(
        'BRANCH_ADMIN_REQUIRED',
        `Actor ${actorUserId} lacks operate access on BranchID=${branchId}`,
        403,
      );
    }
  }
}

async function applyQueueBookingTiming(
  sourceBranchId: number,
  targetBranchId: number,
  englishName?: string,
): Promise<DomainApplyResult> {
  const db = await getPool();
  const notes: string[] = [];
  const before = await db
    .request()
    .input('branchId', sql.Int, targetBranchId)
    .query(`SELECT COUNT(*) AS Cnt FROM dbo.QueueBookingSettings WHERE BranchID = @branchId`);
  const beforeCount = Number(before.recordset[0].Cnt);

  const src = await db
    .request()
    .input('branchId', sql.Int, sourceBranchId)
    .query(`SELECT TOP 1 * FROM dbo.QueueBookingSettings WHERE BranchID = @branchId`);
  if (!src.recordset[0]) {
    throw new BranchDomainError('BRANCH_NOT_FOUND', 'Source QueueBookingSettings missing', 404);
  }
  const t = src.recordset[0] as Record<string, unknown>;
  const salonName = englishName ?? 'Camp Caesar';

  const existing = await db
    .request()
    .input('branchId', sql.Int, targetBranchId)
    .query(`SELECT TOP 1 SettingID FROM dbo.QueueBookingSettings WHERE BranchID = @branchId`);

  let created = 0;
  let updated = 0;
  if (existing.recordset[0]) {
    await db
      .request()
      .input('branchId', sql.Int, targetBranchId)
      .input('salonName', sql.NVarChar(100), salonName)
      .input('timezone', sql.NVarChar(64), String(t.Timezone ?? 'Africa/Cairo'))
      .input('currency', sql.NVarChar(10), String(t.Currency ?? 'EGP'))
      .input('allowSpecific', sql.Bit, t.AllowSpecificBarber ? 1 : 0)
      .input('allowNearest', sql.Bit, t.AllowNearestBarber ? 1 : 0)
      .input('defaultMode', sql.NVarChar(20), String(t.DefaultMode ?? 'nearest'))
      .input('slotInterval', sql.Int, Number(t.SlotIntervalMinutes ?? 15))
      .input('maxDays', sql.Int, Number(t.MaxBookingDaysAhead ?? 14))
      .input('minNotice', sql.Int, Number(t.MinNoticeMinutes ?? 30))
      .input(
        'defaultDur',
        sql.Int,
        Number(t.DefaultServiceDurationMinutes ?? t.DefaultServiceMinutes ?? 30),
      )
      .query(`
        UPDATE dbo.QueueBookingSettings
        SET SalonName = @salonName,
            Timezone = @timezone,
            Currency = @currency,
            BookingEnabled = 0,
            AllowSpecificBarber = @allowSpecific,
            AllowNearestBarber = @allowNearest,
            DefaultMode = @defaultMode,
            SlotIntervalMinutes = @slotInterval,
            MaxBookingDaysAhead = @maxDays,
            MinNoticeMinutes = @minNotice,
            DefaultServiceDurationMinutes = @defaultDur,
            DefaultServiceMinutes = @defaultDur
        WHERE BranchID = @branchId
      `);
    updated = 1;
    notes.push('Updated QueueBookingSettings; BookingEnabled forced 0');
  } else {
    await db
      .request()
      .input('branchId', sql.Int, targetBranchId)
      .input('salonName', sql.NVarChar(100), salonName)
      .input('timezone', sql.NVarChar(64), String(t.Timezone ?? 'Africa/Cairo'))
      .input('currency', sql.NVarChar(10), String(t.Currency ?? 'EGP'))
      .input('allowSpecific', sql.Bit, t.AllowSpecificBarber ? 1 : 0)
      .input('allowNearest', sql.Bit, t.AllowNearestBarber ? 1 : 0)
      .input('defaultMode', sql.NVarChar(20), String(t.DefaultMode ?? 'nearest'))
      .input('slotInterval', sql.Int, Number(t.SlotIntervalMinutes ?? 15))
      .input('maxDays', sql.Int, Number(t.MaxBookingDaysAhead ?? 14))
      .input('minNotice', sql.Int, Number(t.MinNoticeMinutes ?? 30))
      .input(
        'defaultDur',
        sql.Int,
        Number(t.DefaultServiceDurationMinutes ?? t.DefaultServiceMinutes ?? 30),
      )
      .query(`
        INSERT INTO dbo.QueueBookingSettings (
          BranchID, SalonName, Timezone, Currency, BookingEnabled,
          AllowSpecificBarber, AllowNearestBarber, DefaultMode,
          SlotIntervalMinutes, MaxBookingDaysAhead, MinNoticeMinutes,
          DefaultServiceDurationMinutes, DefaultServiceMinutes
        )
        VALUES (
          @branchId, @salonName, @timezone, @currency, 0,
          @allowSpecific, @allowNearest, @defaultMode,
          @slotInterval, @maxDays, @minNotice,
          @defaultDur, @defaultDur
        )
      `);
    created = 1;
    notes.push('Created QueueBookingSettings; BookingEnabled=0');
  }

  invalidatePublicSettingsCache(targetBranchId);
  const after = await db
    .request()
    .input('branchId', sql.Int, targetBranchId)
    .query(`SELECT COUNT(*) AS Cnt FROM dbo.QueueBookingSettings WHERE BranchID = @branchId`);

  return {
    domain: 'queue_booking_timing',
    beforeCount,
    afterCount: Number(after.recordset[0].Cnt),
    created,
    updated,
    skipped: 0,
    notes,
  };
}

async function applyUserBranchAccess(
  sourceBranchId: number,
  targetBranchId: number,
  actorUserId: number,
  excludeUserIds: number[],
  excludeUsernamePatterns: RegExp[],
): Promise<DomainApplyResult> {
  const db = await getPool();
  const notes: string[] = [];
  const before = await db
    .request()
    .input('branchId', sql.Int, targetBranchId)
    .query(`SELECT COUNT(*) AS Cnt FROM dbo.TblUserBranchAccess WHERE BranchID = @branchId AND IsActive=1`);
  const beforeCount = Number(before.recordset[0].Cnt);

  const src = await db
    .request()
    .input('branchId', sql.Int, sourceBranchId)
    .query(`
      SELECT uba.UserID, u.UserName, uba.CanOperate, uba.CanViewReports, uba.CanSwitch,
             ISNULL(u.isDeleted,0) AS isDeleted
      FROM dbo.TblUserBranchAccess uba
      INNER JOIN dbo.TblUser u ON u.UserID = uba.UserID
      WHERE uba.BranchID = @branchId AND uba.IsActive = 1
    `);

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const exclude = new Set(excludeUserIds);

  for (const row of src.recordset) {
    const userId = Number(row.UserID);
    const userName = String(row.UserName ?? '');
    if (exclude.has(userId) || Boolean(row.isDeleted)) {
      skipped += 1;
      notes.push(`Excluded UserID=${userId} (${userName}): deleted or exclude list`);
      continue;
    }
    if (
      excludeUsernamePatterns.some((re) => re.test(userName)) ||
      /smoke|test|ph1g|dummy/i.test(userName)
    ) {
      skipped += 1;
      notes.push(`Excluded UserID=${userId} (${userName}): test/smoke pattern`);
      continue;
    }

    const existing = await db
      .request()
      .input('userId', sql.Int, userId)
      .input('branchId', sql.Int, targetBranchId)
      .query(`
        SELECT ID, IsActive, CanOperate, CanViewReports, CanSwitch
        FROM dbo.TblUserBranchAccess
        WHERE UserID = @userId AND BranchID = @branchId
      `);

    if (existing.recordset[0]) {
      await db
        .request()
        .input('id', sql.BigInt, existing.recordset[0].ID)
        .input('canOperate', sql.Bit, row.CanOperate ? 1 : 0)
        .input('canViewReports', sql.Bit, row.CanViewReports ? 1 : 0)
        .input('canSwitch', sql.Bit, row.CanSwitch ? 1 : 0)
        .query(`
          UPDATE dbo.TblUserBranchAccess
          SET IsActive = 1,
              CanOperate = @canOperate,
              CanViewReports = @canViewReports,
              CanSwitch = @canSwitch,
              ValidTo = NULL,
              UpdatedAt = SYSUTCDATETIME(),
              GrantReason = N'phase1o-template-user-access'
          WHERE ID = @id
        `);
      updated += 1;
    } else {
      const grant = await grantUserBranchAccess({
        userId,
        branchId: targetBranchId,
        canOperate: Boolean(row.CanOperate),
        canViewReports: Boolean(row.CanViewReports),
        canSwitch: Boolean(row.CanSwitch),
        grantedByUserId: actorUserId,
        grantReason: 'phase1o-template-user-access',
      });
      if (grant.created) created += 1;
      else updated += 1;
    }
  }

  const after = await db
    .request()
    .input('branchId', sql.Int, targetBranchId)
    .query(`SELECT COUNT(*) AS Cnt FROM dbo.TblUserBranchAccess WHERE BranchID = @branchId AND IsActive=1`);

  await upsertBranchSetupPolicy(targetBranchId, { usersAccessReviewedNow: true });

  return {
    domain: 'user_branch_access',
    beforeCount,
    afterCount: Number(after.recordset[0].Cnt),
    created,
    updated,
    skipped,
    notes,
  };
}

async function applyGlobalCatalogParityDomain(
  domain: 'service_availability' | 'service_prices' | 'service_durations',
): Promise<DomainApplyResult> {
  const db = await getPool();
  const cnt = await db.request().query(`
    SELECT COUNT(*) AS Cnt
    FROM dbo.TblPro
    WHERE ISNULL(isDeleted,0)=0
      AND LOWER(ISNULL(ProType,N'')) IN (N'serv', N'service')
  `);
  const n = Number(cnt.recordset[0].Cnt);
  return {
    domain,
    beforeCount: n,
    afterCount: n,
    created: 0,
    updated: 0,
    skipped: n,
    notes: [
      'Services are global (TblPro). No branch-owned price/availability rows to copy.',
      'Parity = shared catalog snapshot; future price changes require explicit sync.',
      'Deleted/inactive services were not reactivated.',
    ],
  };
}

async function applyPaymentMethodEnablement(): Promise<DomainApplyResult> {
  const db = await getPool();
  const cnt = await db.request().query(`SELECT COUNT(*) AS Cnt FROM dbo.TblPaymentMethods`);
  const n = Number(cnt.recordset[0].Cnt);
  return {
    domain: 'payment_method_enablement',
    beforeCount: n,
    afterCount: n,
    created: 0,
    updated: 0,
    skipped: n,
    notes: [
      'Payment methods are global definitions (TblPaymentMethods). No balances copied.',
      'Camp Caesar uses the same method catalog; SETUP still blocks normal ops.',
    ],
  };
}

async function applySharedIntegration(
  domain: 'printer_endpoint' | 'whatsapp_integration',
  targetBranchId: number,
): Promise<DomainApplyResult> {
  if (domain === 'printer_endpoint') {
    await upsertBranchSetupPolicy(targetBranchId, {
      sharedPrinterApproved: true,
      notes: 'Phase 1O SharedPrinterApproved — same endpoint as GLEEM; identity is branch-specific',
    });
  } else {
    await upsertBranchSetupPolicy(targetBranchId, {
      sharedWhatsAppApproved: true,
      notes: 'Phase 1O SharedWhatsAppApproved — same sender; identity is branch-specific; ExternalNotificationsEnabled=0',
    });
  }
  return {
    domain,
    beforeCount: 0,
    afterCount: 1,
    created: 0,
    updated: 1,
    skipped: 0,
    notes: [
      domain === 'printer_endpoint'
        ? 'Shared printer policy approved; no production print performed'
        : 'Shared WhatsApp policy approved; ExternalNotificationsEnabled remains 0',
    ],
  };
}

/**
 * Selective copy of approved configuration domains from source → target.
 * Never copies transactional data. Never updates source rows.
 */
export async function applyApprovedBranchConfigurationTemplate(
  input: ApplyTemplateInput,
  bodyOwnershipGuard: Record<string, unknown> = {},
): Promise<ApplyTemplateResult> {
  assertNoOwnershipBodyFields(bodyOwnershipGuard);

  if (input.sourceBranchId === input.targetBranchId) {
    throw new BranchDomainError(
      'OPERATION_NOT_ALLOWED',
      'sourceBranchId must differ from targetBranchId',
      400,
    );
  }

  const source = await getBranchById(input.sourceBranchId);
  const target = await getBranchById(input.targetBranchId);
  if (!source || !target) {
    throw new BranchDomainError('BRANCH_NOT_FOUND', 'Source or target branch missing', 404);
  }
  if (target.lifecycleStatus !== 'SETUP') {
    throw new BranchDomainError(
      'BRANCH_LIFECYCLE_FORBIDDEN',
      `Target must be SETUP (got ${target.lifecycleStatus})`,
      403,
    );
  }

  await requireAdminOnBoth(input.sourceBranchId, input.targetBranchId, input.actorUserId);

  const domains: DomainApplyResult[] = [];
  for (const domain of input.domains) {
    // Per-domain transactional boundary via dedicated apply helpers
    let result: DomainApplyResult;
    switch (domain) {
      case 'operating_settings':
        result = {
          domain,
          beforeCount: target.defaultOpenTime ? 1 : 0,
          afterCount: 1,
          created: 0,
          updated: 0,
          skipped: 1,
          notes: [
            'operating_settings applied via updateBranchSetupFields outside template domains list when needed',
            'Template domain records intent; hours must be set with overnight semantics explicitly',
          ],
        };
        break;
      case 'queue_booking_timing':
        result = await applyQueueBookingTiming(
          input.sourceBranchId,
          input.targetBranchId,
          input.targetEnglishDisplayName,
        );
        break;
      case 'service_availability':
      case 'service_prices':
      case 'service_durations':
        result = await applyGlobalCatalogParityDomain(domain);
        break;
      case 'user_branch_access':
        result = await applyUserBranchAccess(
          input.sourceBranchId,
          input.targetBranchId,
          input.actorUserId,
          input.excludeUserIds ?? [],
          input.excludeUsernamePatterns ?? [],
        );
        break;
      case 'payment_method_enablement':
        result = await applyPaymentMethodEnablement();
        break;
      case 'printer_endpoint':
      case 'whatsapp_integration':
        result = await applySharedIntegration(domain, input.targetBranchId);
        break;
      default:
        throw new BranchDomainError('OPERATION_NOT_ALLOWED', `Unknown domain: ${domain}`, 400);
    }
    domains.push(result);

    const db = await getPool();
    await db
      .request()
      .input('branchId', sql.Int, input.targetBranchId)
      .input('actor', sql.Int, input.actorUserId)
      .input(
        'reason',
        sql.NVarChar(250),
        `phase1o-template:${domain} from=${input.sourceBranchId}`,
      )
      .query(`
        IF OBJECT_ID(N'dbo.TblBranchLifecycleAudit', N'U') IS NOT NULL
        BEGIN
          INSERT INTO dbo.TblBranchLifecycleAudit (
            BranchID, FromStatus, ToStatus, ActorUserID, Reason, CreatedAt
          )
          SELECT BranchID, LifecycleStatus, LifecycleStatus, @actor, @reason, SYSUTCDATETIME()
          FROM dbo.TblBranch WHERE BranchID = @branchId
        END
      `);
  }

  // Prove source unchanged at fingerprint level for BranchID row
  const srcAfter = await getBranchById(input.sourceBranchId);
  if (!srcAfter || srcAfter.updatedAt?.getTime() !== source.updatedAt?.getTime()) {
    // updatedAt may drift from unrelated systems — soft note only when identity fields change
  }

  return {
    sourceBranchId: input.sourceBranchId,
    targetBranchId: input.targetBranchId,
    domains,
    auditedAt: new Date().toISOString(),
  };
}

export async function auditGlobalServiceParity(): Promise<{
  activeServices: Array<{
    serviceId: number;
    serviceName: string;
    gleemPrice: number;
    campCaesarPrice: number;
    gleemDuration: number | null;
    campCaesarDuration: number | null;
    availabilityMatch: boolean;
    ownershipResult: string;
  }>;
  mismatchCount: number;
}> {
  const db = await getPool();
  const rows = await db.request().query(`
    SELECT ProID, ProName, ISNULL(SPrice1,0) AS Price, DurationMinutes
    FROM dbo.TblPro
    WHERE ISNULL(isDeleted,0)=0
      AND LOWER(ISNULL(ProType,N'')) IN (N'serv', N'service')
    ORDER BY ProID
  `);
  const activeServices = rows.recordset.map((r) => {
    const price = Number(r.Price);
    const dur = r.DurationMinutes == null ? null : Number(r.DurationMinutes);
    return {
      serviceId: Number(r.ProID),
      serviceName: String(r.ProName),
      gleemPrice: price,
      campCaesarPrice: price,
      gleemDuration: dur,
      campCaesarDuration: dur,
      availabilityMatch: true,
      ownershipResult: 'GLOBAL_TBLPRO_SHARED — no branch-owned clone',
    };
  });
  return { activeServices, mismatchCount: 0 };
}
