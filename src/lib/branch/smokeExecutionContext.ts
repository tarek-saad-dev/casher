/**
 * Phase 1M-S / 1N-B — explicit smoke execution context.
 *
 * NOT a generic allowInactive bypass.
 * Valid only when:
 * - BranchCode is an allowed smoke branch (PH1GTEST | CAMP_CAESAR)
 * - LifecycleStatus = SMOKE_TEST (or SETUP during prep under a RUNNING run)
 * - PublicBookingEnabled = 0
 * - IsActive = 0
 * - SmokeRunID is RUNNING
 * - ExternalSideEffectsEnabled = 0
 */
import 'server-only';
import { AsyncLocalStorage } from 'async_hooks';
import { getPool, sql } from '@/lib/db';
import { getBranchById } from './repository';
import { BranchDomainError } from './types';
import {
  GLEEM_BRANCH_CODE,
  isAllowedSmokeBranchCode,
  type AllowedSmokeBranchCode,
} from './smokeBranchPolicy';

export type SmokeExecutionContext = {
  smokeRunId: number;
  branchId: number;
  branchCode: AllowedSmokeBranchCode;
  actorUserId: number;
  workDate: string;
  externalSideEffectsEnabled: false;
};

const storage = new AsyncLocalStorage<SmokeExecutionContext>();

export function getSmokeExecutionContext(): SmokeExecutionContext | null {
  return storage.getStore() ?? null;
}

export function isSmokeExecutionActiveForBranch(branchId: number): boolean {
  const ctx = getSmokeExecutionContext();
  return !!ctx && ctx.branchId === branchId;
}

/**
 * Load + validate a live smoke run. Refuses GLEEM / non-allowlisted branches / non-RUNNING.
 */
export async function loadValidatedSmokeExecutionContext(args: {
  smokeRunId: number;
  branchId: number;
  actorUserId: number;
  workDate: string;
}): Promise<SmokeExecutionContext> {
  if (!args.smokeRunId || args.smokeRunId <= 0) {
    throw new BranchDomainError('BRANCH_NOT_READY', 'SmokeRunID مطلوب', 400);
  }
  if (args.branchId === 1) {
    throw new BranchDomainError(
      'BRANCH_LIFECYCLE_FORBIDDEN',
      'Smoke API يرفض GLEEM BranchID',
      409,
    );
  }

  const branch = await getBranchById(args.branchId);
  if (!branch) {
    throw new BranchDomainError('BRANCH_NOT_FOUND', 'الفرع غير موجود', 404);
  }
  if (branch.branchCode === GLEEM_BRANCH_CODE) {
    throw new BranchDomainError(
      'BRANCH_LIFECYCLE_FORBIDDEN',
      'Smoke يرفض GLEEM',
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
  if (branch.isActive) {
    throw new BranchDomainError(
      'BRANCH_LIFECYCLE_FORBIDDEN',
      'Smoke يتطلب IsActive=0 — لا تفعّل الفرع',
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
  if (
    branch.lifecycleStatus !== 'SMOKE_TEST' &&
    branch.lifecycleStatus !== 'SETUP'
  ) {
    throw new BranchDomainError(
      'BRANCH_LIFECYCLE_FORBIDDEN',
      `Lifecycle غير صالح للـ smoke: ${branch.lifecycleStatus}`,
      409,
    );
  }

  const db = await getPool();
  const run = await db
    .request()
    .input('runId', sql.BigInt, args.smokeRunId)
    .input('branchId', sql.Int, args.branchId)
    .query(`
      SELECT SmokeRunID, BranchID, Status, ExternalSideEffectsEnabled
      FROM dbo.TblBranchSmokeRun
      WHERE SmokeRunID = @runId AND BranchID = @branchId
    `);
  const row = run.recordset[0];
  if (!row) {
    throw new BranchDomainError('BRANCH_NOT_FOUND', 'Smoke run غير موجود', 404);
  }
  if (String(row.Status) !== 'RUNNING') {
    throw new BranchDomainError(
      'BRANCH_LIFECYCLE_FORBIDDEN',
      `SmokeRun غير نشط (Status=${row.Status})`,
      409,
    );
  }
  if (Boolean(row.ExternalSideEffectsEnabled)) {
    throw new BranchDomainError(
      'BRANCH_LIFECYCLE_FORBIDDEN',
      'ExternalSideEffectsEnabled يجب أن يكون 0',
      409,
    );
  }

  return {
    smokeRunId: args.smokeRunId,
    branchId: args.branchId,
    branchCode: branch.branchCode,
    actorUserId: args.actorUserId,
    workDate: args.workDate,
    externalSideEffectsEnabled: false,
  };
}

export async function withSmokeExecutionContext<T>(
  ctx: SmokeExecutionContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(ctx, fn);
}
