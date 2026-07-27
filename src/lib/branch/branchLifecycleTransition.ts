/**
 * Phase 1M — lifecycle transitions (server-enforced).
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import { getBranchById } from './repository';
import { evaluateBranchReadiness } from './branchReadinessService';
import {
  capabilitiesFor,
  isBranchLifecycleStatus,
  isForbiddenLifecycleJump,
  isTransitionAllowed,
  type BranchLifecycleStatus,
} from './lifecycle';
import { BranchDomainError } from './types';
import type { BranchRecord } from './types';
import { invalidatePublicSettingsCache } from '@/lib/publicBookingHelpers';

export type TransitionBranchLifecycleInput = {
  branchId: number;
  targetStatus: BranchLifecycleStatus;
  actorUserId: number;
  reason: string;
  /** Required evidence when leaving SMOKE_TEST → INTERNAL_LIVE */
  smokeRunId?: number;
};

export type TransitionBranchLifecycleResult = {
  branch: BranchRecord;
  fromStatus: BranchLifecycleStatus;
  toStatus: BranchLifecycleStatus;
  readinessBlockers: number;
};

export async function transitionBranchLifecycle(
  input: TransitionBranchLifecycleInput,
): Promise<TransitionBranchLifecycleResult> {
  const reason = (input.reason ?? '').trim();
  if (reason.length < 5) {
    throw new BranchDomainError(
      'BRANCH_LIFECYCLE_FORBIDDEN',
      'سبب التحويل مطلوب (5 أحرف على الأقل)',
      400,
    );
  }
  if (!isBranchLifecycleStatus(input.targetStatus)) {
    throw new BranchDomainError(
      'BRANCH_LIFECYCLE_FORBIDDEN',
      'حالة غير صالحة',
      400,
    );
  }

  const branch = await getBranchById(input.branchId);
  if (!branch) {
    throw new BranchDomainError('BRANCH_NOT_FOUND', 'الفرع غير موجود', 404);
  }

  const from = branch.lifecycleStatus;
  const to = input.targetStatus;

  if (isForbiddenLifecycleJump(from, to) || !isTransitionAllowed(from, to)) {
    console.warn(
      JSON.stringify({
        event: 'branch.lifecycle.transition.blocked',
        branchId: branch.branchId,
        branchCode: branch.branchCode,
        fromStatus: from,
        toStatus: to,
        actorUserId: input.actorUserId,
        reason: 'forbidden_or_disallowed_transition',
      }),
    );
    throw new BranchDomainError(
      'BRANCH_LIFECYCLE_FORBIDDEN',
      `تحويل غير مسموح: ${from} → ${to}`,
      409,
    );
  }

  // Never public-enable PH1GTEST through this API
  if (branch.branchCode === 'PH1GTEST' && to === 'PUBLIC_LIVE') {
    throw new BranchDomainError(
      'BRANCH_LIFECYCLE_FORBIDDEN',
      'PH1GTEST لا يمكن أن يصبح PUBLIC_LIVE',
      409,
    );
  }

  const readiness = await evaluateBranchReadiness(branch.branchId);
  if (to === 'SMOKE_TEST' && !readiness.isReadyForSmoke) {
    throw new BranchDomainError(
      'BRANCH_NOT_READY',
      `غير جاهز للـ smoke — ${readiness.blockers.length} مانع`,
      409,
    );
  }
  if (to === 'INTERNAL_LIVE' && !readiness.isReadyForInternalLive) {
    throw new BranchDomainError(
      'BRANCH_NOT_READY',
      `غير جاهز لـ INTERNAL_LIVE — ${readiness.blockers.length} مانع`,
      409,
    );
  }
  if (to === 'PUBLIC_LIVE' && !readiness.isReadyForPublicLive) {
    throw new BranchDomainError(
      'BRANCH_NOT_READY',
      `غير جاهز لـ PUBLIC_LIVE — ${readiness.blockers.length} مانع`,
      409,
    );
  }

  if (from === 'SMOKE_TEST' && to === 'INTERNAL_LIVE') {
    if (!input.smokeRunId) {
      throw new BranchDomainError(
        'BRANCH_NOT_READY',
        'SmokeRunID مطلوب للانتقال من SMOKE_TEST إلى INTERNAL_LIVE',
        409,
      );
    }
    const dbCheck = await getPool();
    const run = await dbCheck
      .request()
      .input('runId', sql.BigInt, input.smokeRunId)
      .input('branchId', sql.Int, branch.branchId)
      .query(`
        SELECT TOP 1 Status, CleanupStatus
        FROM dbo.TblBranchSmokeRun
        WHERE SmokeRunID = @runId AND BranchID = @branchId
      `);
    const status = String(run.recordset[0]?.Status ?? '');
    const cleanup = String(run.recordset[0]?.CleanupStatus ?? '');
    const ok =
      status === 'PASSED' ||
      (status === 'CLEANED' && (cleanup === 'COMPLETED' || cleanup === 'CLEANED'));
    if (!ok) {
      throw new BranchDomainError(
        'BRANCH_NOT_READY',
        'يجب أن تكون نتيجة الـ smoke PASSED أو CLEANED(مكتمل) قبل INTERNAL_LIVE',
        409,
      );
    }
  }

  const caps = capabilitiesFor(to);
  const publicBookingEnabled = to === 'PUBLIC_LIVE' ? true : false;
  const externalNotificationsEnabled = caps.externalNotifications;

  const db = await getPool();
  const tx = new sql.Transaction(db);
  await tx.begin();
  try {
    const req = new sql.Request(tx);
    await req
      .input('branchId', sql.Int, branch.branchId)
      .input('lifecycle', sql.NVarChar(30), to)
      .input('isActive', sql.Bit, caps.isActive ? 1 : 0)
      .input('publicBooking', sql.Bit, publicBookingEnabled ? 1 : 0)
      .input('extNotify', sql.Bit, externalNotificationsEnabled ? 1 : 0)
      .query(`
        UPDATE dbo.TblBranch
        SET
          LifecycleStatus = @lifecycle,
          IsActive = @isActive,
          PublicBookingEnabled = @publicBooking,
          ExternalNotificationsEnabled = @extNotify,
          UpdatedAt = SYSUTCDATETIME()
        WHERE BranchID = @branchId
      `);

    // Keep QueueBookingSettings.BookingEnabled aligned with public gate
    await new sql.Request(tx)
      .input('branchId', sql.Int, branch.branchId)
      .input('bookingEnabled', sql.Bit, publicBookingEnabled ? 1 : 0)
      .query(`
        UPDATE dbo.QueueBookingSettings
        SET BookingEnabled = @bookingEnabled, UpdatedAt = GETDATE()
        WHERE BranchID = @branchId
      `);

    await new sql.Request(tx)
      .input('branchId', sql.Int, branch.branchId)
      .input('fromStatus', sql.NVarChar(30), from)
      .input('toStatus', sql.NVarChar(30), to)
      .input('reason', sql.NVarChar(500), reason.slice(0, 500))
      .input('actor', sql.Int, input.actorUserId)
      .input(
        'readiness',
        sql.NVarChar(sql.MAX),
        JSON.stringify({
          score: readiness.score,
          blockers: readiness.blockers.map((b) => b.key),
          smokeRunId: input.smokeRunId ?? null,
        }),
      )
      .query(`
        INSERT INTO dbo.TblBranchLifecycleAudit (
          BranchID, FromStatus, ToStatus, Reason, ActorUserID, ReadinessJson
        )
        VALUES (@branchId, @fromStatus, @toStatus, @reason, @actor, @readiness)
      `);

    await tx.commit();
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      /* ignore */
    }
    throw err;
  }

  invalidatePublicSettingsCache(branch.branchId);
  const updated = await getBranchById(branch.branchId);
  if (!updated) {
    throw new BranchDomainError('BRANCH_NOT_FOUND', 'الفرع غير موجود بعد التحويل', 500);
  }

  console.info(
    JSON.stringify({
      event: 'branch.lifecycle.transition.completed',
      branchId: updated.branchId,
      branchCode: updated.branchCode,
      fromStatus: from,
      toStatus: to,
      actorUserId: input.actorUserId,
      readinessBlockers: readiness.blockers.length,
    }),
  );

  return {
    branch: updated,
    fromStatus: from,
    toStatus: to,
    readinessBlockers: readiness.blockers.length,
  };
}
