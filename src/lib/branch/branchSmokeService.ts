/**
 * Phase 1M/1N — controlled smoke run registry.
 * Allowed: PH1GTEST (legacy) and CAMP_CAESAR (real #2 technical smoke).
 * Never GLEEM. Does not activate branches.
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import { getBranchById } from './repository';
import { BranchDomainError } from './types';
import {
  GLEEM_BRANCH_CODE,
  isAllowedSmokeBranchCode,
} from './smokeBranchPolicy';

export {
  GLEEM_BRANCH_CODE,
  SMOKE_BRANCH_CODE,
  LEGACY_SMOKE_BRANCH_CODE,
  isAllowedSmokeBranchCode,
} from './smokeBranchPolicy';

export type SmokeRunRecord = {
  smokeRunId: number;
  branchId: number;
  status: string;
  purpose: string;
  externalSideEffectsEnabled: boolean;
  cleanupStatus: string;
  startedByUserId: number;
  startedAt: Date;
  completedAt: Date | null;
};

export async function assertSmokeBranch(branchId: number): Promise<{
  branchId: number;
  branchCode: string;
}> {
  const branch = await getBranchById(branchId);
  if (!branch) {
    throw new BranchDomainError('BRANCH_NOT_FOUND', 'الفرع غير موجود', 404);
  }
  if (branch.branchCode === GLEEM_BRANCH_CODE) {
    throw new BranchDomainError(
      'BRANCH_LIFECYCLE_FORBIDDEN',
      'لا يمكن تشغيل smoke على GLEEM',
      409,
    );
  }
  if (!isAllowedSmokeBranchCode(branch.branchCode)) {
    throw new BranchDomainError(
      'BRANCH_LIFECYCLE_FORBIDDEN',
      `Smoke مسموح فقط على فروع الاختبار المعتمدة (ليس ${branch.branchCode})`,
      409,
    );
  }
  if (branch.publicBookingEnabled || branch.lifecycleStatus === 'PUBLIC_LIVE') {
    throw new BranchDomainError(
      'BRANCH_LIFECYCLE_FORBIDDEN',
      'فرع الـ smoke لا يجب أن يكون عاماً',
      409,
    );
  }
  return { branchId: branch.branchId, branchCode: branch.branchCode };
}

export async function startBranchSmokeRun(args: {
  branchId: number;
  actorUserId: number;
  purpose: string;
  beforeFingerprintJson?: string;
}): Promise<SmokeRunRecord> {
  const started = Date.now();
  const branch = await assertSmokeBranch(args.branchId);
  const purpose = (args.purpose ?? '').trim();
  if (purpose.length < 3) {
    throw new BranchDomainError('BRANCH_NOT_READY', 'Purpose مطلوب', 400);
  }

  const db = await getPool();
  const result = await db
    .request()
    .input('branchId', sql.Int, branch.branchId)
    .input('actor', sql.Int, args.actorUserId)
    .input('purpose', sql.NVarChar(200), purpose.slice(0, 200))
    .input('beforeFp', sql.NVarChar(sql.MAX), args.beforeFingerprintJson ?? null)
    .query(`
      INSERT INTO dbo.TblBranchSmokeRun (
        BranchID, Status, StartedByUserID, Purpose,
        ExternalSideEffectsEnabled, BeforeFingerprintJson, CleanupStatus
      )
      OUTPUT INSERTED.SmokeRunID, INSERTED.Status, INSERTED.StartedAt, INSERTED.CleanupStatus
      VALUES (
        @branchId, N'RUNNING', @actor, @purpose,
        0, @beforeFp, N'NONE'
      )
    `);

  const row = result.recordset[0];
  console.info(
    JSON.stringify({
      event: 'branch.smoke.started',
      branchId: branch.branchId,
      branchCode: branch.branchCode,
      smokeRunId: Number(row.SmokeRunID),
      actorUserId: args.actorUserId,
      durationMs: Date.now() - started,
    }),
  );

  return {
    smokeRunId: Number(row.SmokeRunID),
    branchId: branch.branchId,
    status: String(row.Status),
    purpose,
    externalSideEffectsEnabled: false,
    cleanupStatus: String(row.CleanupStatus),
    startedByUserId: args.actorUserId,
    startedAt: row.StartedAt instanceof Date ? row.StartedAt : new Date(String(row.StartedAt)),
    completedAt: null,
  };
}

export async function registerSmokeArtifact(args: {
  smokeRunId: number;
  entityType: string;
  entityId: string | number;
  cleanupOrder?: number;
}): Promise<void> {
  const db = await getPool();
  await db
    .request()
    .input('runId', sql.BigInt, args.smokeRunId)
    .input('entityType', sql.NVarChar(80), args.entityType.slice(0, 80))
    .input('entityId', sql.NVarChar(80), String(args.entityId).slice(0, 80))
    .input('order', sql.Int, args.cleanupOrder ?? 100)
    .query(`
      INSERT INTO dbo.TblBranchSmokeArtifact (
        SmokeRunID, EntityType, EntityID, CleanupOrder, CleanupStatus
      )
      VALUES (@runId, @entityType, @entityId, @order, N'PENDING')
    `);
}

export async function getBranchSmokeRun(
  branchId: number,
  smokeRunId: number,
): Promise<SmokeRunRecord & { artifacts: Array<{ entityType: string; entityId: string; cleanupStatus: string }> }> {
  await assertSmokeBranch(branchId);
  const db = await getPool();
  const run = await db
    .request()
    .input('runId', sql.BigInt, smokeRunId)
    .input('branchId', sql.Int, branchId)
    .query(`
      SELECT SmokeRunID, BranchID, Status, Purpose, ExternalSideEffectsEnabled,
             CleanupStatus, StartedByUserID, StartedAt, CompletedAt
      FROM dbo.TblBranchSmokeRun
      WHERE SmokeRunID = @runId AND BranchID = @branchId
    `);
  if (!run.recordset[0]) {
    throw new BranchDomainError('BRANCH_NOT_FOUND', 'Smoke run غير موجود', 404);
  }
  const row = run.recordset[0];
  const arts = await db
    .request()
    .input('runId', sql.BigInt, smokeRunId)
    .query(`
      SELECT EntityType, EntityID, CleanupStatus
      FROM dbo.TblBranchSmokeArtifact
      WHERE SmokeRunID = @runId
      ORDER BY CleanupOrder, SmokeArtifactID
    `);

  return {
    smokeRunId: Number(row.SmokeRunID),
    branchId: Number(row.BranchID),
    status: String(row.Status),
    purpose: String(row.Purpose),
    externalSideEffectsEnabled: Boolean(row.ExternalSideEffectsEnabled),
    cleanupStatus: String(row.CleanupStatus),
    startedByUserId: Number(row.StartedByUserID ?? 0),
    startedAt: row.StartedAt instanceof Date ? row.StartedAt : new Date(String(row.StartedAt)),
    completedAt:
      row.CompletedAt == null
        ? null
        : row.CompletedAt instanceof Date
          ? row.CompletedAt
          : new Date(String(row.CompletedAt)),
    artifacts: arts.recordset.map((a: Record<string, unknown>) => ({
      entityType: String(a.EntityType),
      entityId: String(a.EntityID),
      cleanupStatus: String(a.CleanupStatus),
    })),
  };
}

export async function markBranchSmokeRunStatus(args: {
  smokeRunId: number;
  branchId: number;
  status: 'PASSED' | 'FAILED' | 'ABORTED';
  resultJson?: unknown;
  afterFingerprintJson?: unknown;
}): Promise<void> {
  await assertSmokeBranch(args.branchId);
  const db = await getPool();
  await db
    .request()
    .input('runId', sql.BigInt, args.smokeRunId)
    .input('branchId', sql.Int, args.branchId)
    .input('status', sql.NVarChar(30), args.status)
    .input(
      'result',
      sql.NVarChar(sql.MAX),
      args.resultJson != null ? JSON.stringify(args.resultJson) : null,
    )
    .input(
      'afterFp',
      sql.NVarChar(sql.MAX),
      args.afterFingerprintJson != null
        ? JSON.stringify(args.afterFingerprintJson)
        : null,
    )
    .query(`
      UPDATE dbo.TblBranchSmokeRun
      SET Status = @status,
          ResultJson = COALESCE(@result, ResultJson),
          AfterFingerprintJson = COALESCE(@afterFp, AfterFingerprintJson),
          CompletedAt = SYSUTCDATETIME()
      WHERE SmokeRunID = @runId AND BranchID = @branchId AND Status = N'RUNNING'
    `);
}

/**
 * Marks artifacts cleaned and returns PH1GTEST to SETUP.
 * Prefer deleting/reversing registered artifacts in the cleanup script before calling this.
 */
export async function cleanupBranchSmokeRun(args: {
  branchId: number;
  smokeRunId: number;
  actorUserId: number;
  markArtifactsCleaned?: boolean;
}): Promise<{ cleanupStatus: string; artifactCount: number }> {
  const started = Date.now();
  const branch = await assertSmokeBranch(args.branchId);
  console.info(
    JSON.stringify({
      event: 'branch.smoke.cleanup.started',
      branchId: branch.branchId,
      smokeRunId: args.smokeRunId,
      actorUserId: args.actorUserId,
    }),
  );

  const db = await getPool();
  const run = await db
    .request()
    .input('runId', sql.BigInt, args.smokeRunId)
    .input('branchId', sql.Int, args.branchId)
    .query(`
      SELECT SmokeRunID, BranchID FROM dbo.TblBranchSmokeRun
      WHERE SmokeRunID = @runId AND BranchID = @branchId
    `);
  if (!run.recordset[0]) {
    throw new BranchDomainError('BRANCH_NOT_FOUND', 'Smoke run غير موجود', 404);
  }

  // Refuse if somehow pointed at GLEEM
  const gleem = await db.request().query(`
    SELECT TOP 1 BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM'
  `);
  const gleemId = gleem.recordset[0] ? Number(gleem.recordset[0].BranchID) : null;
  if (gleemId != null && gleemId === args.branchId) {
    throw new BranchDomainError(
      'BRANCH_LIFECYCLE_FORBIDDEN',
      'Cleanup يرفض BranchID الخاص بـ GLEEM',
      409,
    );
  }

  if (args.markArtifactsCleaned !== false) {
    await db
      .request()
      .input('runId', sql.BigInt, args.smokeRunId)
      .query(`
        UPDATE dbo.TblBranchSmokeArtifact
        SET CleanupStatus = N'CLEANED', CleanupNote = N'marked_by_cleanup_api'
        WHERE SmokeRunID = @runId AND CleanupStatus = N'PENDING'
      `);
  }

  const countRes = await db
    .request()
    .input('runId', sql.BigInt, args.smokeRunId)
    .query(`
      SELECT COUNT(*) AS cnt FROM dbo.TblBranchSmokeArtifact WHERE SmokeRunID = @runId
    `);
  const artifactCount = Number(countRes.recordset[0].cnt);

  await db
    .request()
    .input('runId', sql.BigInt, args.smokeRunId)
    .query(`
      UPDATE dbo.TblBranchSmokeRun
      SET Status = N'CLEANED',
          CleanupStatus = N'COMPLETED',
          CompletedAt = SYSUTCDATETIME()
      WHERE SmokeRunID = @runId
    `);

  // Demote only SMOKE_TEST → SETUP after controlled smoke cleanup.
  // INTERNAL_LIVE / PUBLIC_LIVE must never be deactivated by artifact cleanup
  // (regression: admin cleanup after current-config smoke was resetting Camp Caesar).
  const liveBranch = await getBranchById(args.branchId);
  if (
    liveBranch?.lifecycleStatus === 'PUBLIC_LIVE' ||
    liveBranch?.publicBookingEnabled === true
  ) {
    console.warn(
      JSON.stringify({
        event: 'branch.smoke.cleanup.skip_demote_public_live',
        branchId: args.branchId,
        branchCode: liveBranch.branchCode,
        lifecycleStatus: liveBranch.lifecycleStatus,
        publicBookingEnabled: liveBranch.publicBookingEnabled,
        smokeRunId: args.smokeRunId,
      }),
    );
  } else if (liveBranch?.lifecycleStatus === 'SMOKE_TEST') {
    await db
      .request()
      .input('branchId', sql.Int, args.branchId)
      .input('code', sql.NVarChar(30), branch.branchCode)
      .query(`
        UPDATE dbo.TblBranch
        SET LifecycleStatus = N'SETUP',
            IsActive = 0,
            PublicBookingEnabled = 0,
            ExternalNotificationsEnabled = 0,
            UpdatedAt = SYSUTCDATETIME()
        WHERE BranchID = @branchId
          AND BranchCode = @code
          AND LifecycleStatus = N'SMOKE_TEST'
          AND ISNULL(PublicBookingEnabled, 0) = 0
      `);

    await db
      .request()
      .input('branchId', sql.Int, args.branchId)
      .query(`
        UPDATE dbo.QueueBookingSettings
        SET BookingEnabled = 0, UpdatedAt = GETDATE()
        WHERE BranchID = @branchId
          AND EXISTS (
            SELECT 1 FROM dbo.TblBranch b
            WHERE b.BranchID = @branchId
              AND b.LifecycleStatus = N'SMOKE_TEST'
              AND ISNULL(b.PublicBookingEnabled, 0) = 0
          )
      `);
  } else if (liveBranch) {
    console.info(
      JSON.stringify({
        event: 'branch.smoke.cleanup.skip_demote_non_smoke',
        branchId: args.branchId,
        branchCode: liveBranch.branchCode,
        lifecycleStatus: liveBranch.lifecycleStatus,
        smokeRunId: args.smokeRunId,
      }),
    );
  }

  console.info(
    JSON.stringify({
      event: 'branch.smoke.cleanup.completed',
      branchId: branch.branchId,
      smokeRunId: args.smokeRunId,
      artifactCount,
      actorUserId: args.actorUserId,
      durationMs: Date.now() - started,
    }),
  );

  return { cleanupStatus: 'COMPLETED', artifactCount };
}
