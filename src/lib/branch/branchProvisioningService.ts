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
import { getBranchById } from './repository';
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

export async function provisionBranch(
  input: ProvisionBranchInput,
  authenticatedUser: { userId: number },
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

    const sourceCode =
      input.template?.sourceBranchCode?.trim().toUpperCase() || 'GLEEM';

    const branch = await createBranchRecord({
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
    });

    const seedOpts: SeedQueueSettingsInput = {
      bookingEnabled: false,
      ...(input.template?.queueBookingSettings
        ? { copyFromBranchCode: sourceCode, bookingEnabled: false }
        : {}),
    };

    const { created: queueSettingsCreated } = await ensureQueueBookingSettingsForBranch(
      branch.branchId,
      seedOpts,
    );

    let partnerSharesSeeded = 0;
    if (input.template?.partnerShares) {
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
