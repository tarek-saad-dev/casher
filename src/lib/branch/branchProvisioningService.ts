/**
 * Phase 1M — safe branch provisioning.
 * Creates SETUP branches only. Never copies transactional / financial data.
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import {
  assertBranchIdentityAvailable,
  createBranchRecord,
  ensureQueueBookingSettingsForBranch,
  grantUserBranchAccess,
  seedPartnerSharesFromSourceBranch,
  type SeedQueueSettingsInput,
} from './bootstrap';
import { getBranchByCode, getBranchById } from './repository';
import { assertCanAddBranch } from '@/platform/commercial/limits';
import { ensureLegacyIdMapInTransaction } from '@/platform/onboarding/legacyIdMap';
import { assertLegacyBranchInTenant, isTenantContextError } from '@/platform/tenant/tenantContext';
import type { BranchRecord } from './types';
import { BranchDomainError } from './types';

export type ProvisionTemplateCopy = {
  /** Copy queue/booking interval settings from source (BookingEnabled forced off). */
  queueBookingSettings?: boolean;
  /** Copy open-ended partner share percentages (not balances). */
  partnerShares?: boolean;
  sourceBranchCode?: string;
};

export type ProvisionBranchInput = {
  branchCode: string;
  branchName: string;
  shortName?: string | null;
  address?: string | null;
  phone?: string | null;
  timeZone?: string;
  businessDayCutoffTime?: string;
  defaultOpenTime?: string | null;
  defaultCloseTime?: string | null;
  /** Optional: grant the provisioning actor operate/report/switch access. */
  grantActorAccess?: boolean;
  template?: ProvisionTemplateCopy;
  /** Rejected if present — documented for API validation. */
  branchId?: unknown;
  isActive?: unknown;
  lifecycleStatus?: unknown;
  publicBookingEnabled?: unknown;
  createdBy?: unknown;
};

export type ProvisionBranchResult = {
  branch: BranchRecord;
  queueSettingsCreated: boolean;
  partnerSharesSeeded: number;
  actorAccessGranted: boolean;
};

function rejectEscalationFields(input: ProvisionBranchInput): void {
  const forbidden: Array<keyof ProvisionBranchInput> = [
    'branchId',
    'isActive',
    'lifecycleStatus',
    'publicBookingEnabled',
    'createdBy',
  ];
  for (const key of forbidden) {
    if (input[key] !== undefined) {
      throw new BranchDomainError(
        'BRANCH_LIFECYCLE_FORBIDDEN',
        `حقل النظام غير مسموح في الطلب: ${String(key)}`,
        400,
      );
    }
  }
}

/**
 * DRVO-013: a branch exists for the platform only as a Location of exactly one tenant.
 * The tenant branch limit (DRVO-012) is taken first and held while the legacy branch row is
 * created; the Location + LegacyIdMap rows are written in the same tenant transaction. If the
 * tenant attach fails, the just-created SETUP branch is removed so no tenant-less branch remains.
 */
async function createBranchForTenant(
  tenantId: string,
  create: () => Promise<BranchRecord>,
): Promise<BranchRecord> {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  let branch: BranchRecord | null = null;
  try {
    await assertCanAddBranch(tx, tenantId);
    branch = await create();
    const location = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('legacyBranchId', sql.Int, branch.branchId)
      .input('branchCode', sql.NVarChar(64), branch.branchCode)
      .input('tz', sql.NVarChar(64), branch.timeZone || 'Africa/Cairo')
      .query(`
        INSERT INTO dbo.Location (TenantId, LegacyBranchId, BranchCode, Timezone, Status)
        OUTPUT INSERTED.LocationId AS locationId
        VALUES (@tenantId, @legacyBranchId, @branchCode, @tz, N'active');
      `);
    await ensureLegacyIdMapInTransaction(tx, {
      tenantId,
      entityName: 'branch',
      legacyKey: String(branch.branchId),
      authoritativeDrvoId: String((location.recordset[0] as { locationId: string }).locationId),
    });
    await tx.commit();
    return branch;
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      /* already rolled back */
    }
    if (branch) {
      await pool
        .request()
        .input('branchId', sql.Int, branch.branchId)
        .query(`
          DELETE FROM dbo.TblBranch
          WHERE BranchID = @branchId AND LifecycleStatus = N'SETUP' AND IsActive = 0;
        `)
        .catch((cleanupErr: unknown) => {
          console.error('[branch.provision] tenant attach cleanup failed', {
            branchId: branch?.branchId,
            error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
          });
        });
    }
    throw err;
  }
}

export async function provisionBranch(
  input: ProvisionBranchInput,
  authenticatedUser: { userId: number; tenantId: string },
): Promise<ProvisionBranchResult> {
  const started = Date.now();
  console.info(
    JSON.stringify({
      event: 'branch.provision.started',
      actorUserId: authenticatedUser.userId,
      branchCode: String(input.branchCode ?? '').toUpperCase(),
    }),
  );

  try {
    rejectEscalationFields(input);

    await assertBranchIdentityAvailable({
      branchCode: input.branchCode,
      branchName: input.branchName,
      shortName: input.shortName,
    });

    const sourceCode = input.template?.sourceBranchCode?.trim().toUpperCase();
    if (sourceCode) {
      // Templates may only be copied from a branch of the same tenant (non-disclosing).
      const source = await getBranchByCode(sourceCode);
      const inTenant = source
        ? await assertLegacyBranchInTenant(authenticatedUser.tenantId, source.branchId).then(
            () => true,
            (err: unknown) => {
              if (isTenantContextError(err)) return false;
              throw err;
            },
          )
        : false;
      if (!inTenant) {
        throw new BranchDomainError('BRANCH_NOT_FOUND', 'فرع القالب غير موجود', 404);
      }
    }

    const branch = await createBranchForTenant(authenticatedUser.tenantId, () =>
      createBranchRecord({
        branchCode: input.branchCode,
        branchName: input.branchName,
        shortName: input.shortName,
        address: input.address,
        phone: input.phone,
        timeZone: input.timeZone,
        businessDayCutoffTime: input.businessDayCutoffTime,
        defaultOpenTime: input.defaultOpenTime,
        defaultCloseTime: input.defaultCloseTime,
        createdByUserId: authenticatedUser.userId,
        // ignored by create — kept for type compat
        isActive: false,
      }),
    );

    const seedOpts: SeedQueueSettingsInput = {
      bookingEnabled: false,
      ...(input.template?.queueBookingSettings && sourceCode
        ? { copyFromBranchCode: sourceCode, bookingEnabled: false }
        : {}),
    };

    const { created: queueSettingsCreated } = await ensureQueueBookingSettingsForBranch(
      branch.branchId,
      seedOpts,
    );

    let partnerSharesSeeded = 0;
    if (input.template?.partnerShares) {
      if (!sourceCode) {
        throw new BranchDomainError(
          'BRANCH_LIFECYCLE_FORBIDDEN',
          'template.sourceBranchCode is required when partnerShares is enabled',
          400,
        );
      }
      partnerSharesSeeded = await seedPartnerSharesFromSourceBranch({
        targetBranchId: branch.branchId,
        sourceBranchCode: sourceCode,
      });
    }

    let actorAccessGranted = false;
    if (input.grantActorAccess !== false) {
      const grant = await grantUserBranchAccess({
        userId: authenticatedUser.userId,
        branchId: branch.branchId,
        canOperate: true,
        canViewReports: true,
        canSwitch: true,
        grantedByUserId: authenticatedUser.userId,
        grantReason: 'phase1m-provision',
      });
      actorAccessGranted = grant.created || grant.reactivated;
    }

    // Sensitive audit row (lifecycle already SETUP via create)
    const db = await getPool();
    await db
      .request()
      .input('branchId', sql.Int, branch.branchId)
      .input('fromStatus', sql.NVarChar(30), 'SETUP')
      .input('toStatus', sql.NVarChar(30), 'SETUP')
      .input('reason', sql.NVarChar(500), 'Branch provisioned in SETUP mode')
      .input('actor', sql.Int, authenticatedUser.userId)
      .input(
        'readiness',
        sql.NVarChar(sql.MAX),
        JSON.stringify({
          queueSettingsCreated,
          partnerSharesSeeded,
          template: input.template ?? null,
        }),
      )
      .query(`
        IF OBJECT_ID(N'dbo.TblBranchLifecycleAudit', N'U') IS NOT NULL
        BEGIN
          INSERT INTO dbo.TblBranchLifecycleAudit (
            BranchID, FromStatus, ToStatus, Reason, ActorUserID, ReadinessJson
          )
          VALUES (@branchId, @fromStatus, @toStatus, @reason, @actor, @readiness)
        END
      `);

    const fresh = (await getBranchById(branch.branchId)) ?? branch;

    if (
      fresh.isActive ||
      fresh.publicBookingEnabled ||
      fresh.lifecycleStatus !== 'SETUP'
    ) {
      throw new BranchDomainError(
        'BRANCH_LIFECYCLE_FORBIDDEN',
        'فشل ضمان حالة SETUP بعد الإنشاء',
        500,
      );
    }

    console.info(
      JSON.stringify({
        event: 'branch.provision.completed',
        branchId: fresh.branchId,
        branchCode: fresh.branchCode,
        lifecycleStatus: fresh.lifecycleStatus,
        actorUserId: authenticatedUser.userId,
        durationMs: Date.now() - started,
      }),
    );

    return {
      branch: fresh,
      queueSettingsCreated,
      partnerSharesSeeded,
      actorAccessGranted,
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'branch.provision.failed',
        actorUserId: authenticatedUser.userId,
        branchCode: String(input.branchCode ?? '').toUpperCase(),
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      }),
    );
    throw err;
  }
}
