/**
 * Phase 1O — safe TblBranch identity / contact / hours updates (SETUP targets only by default).
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import { getBranchById } from './repository';
import { BranchDomainError, type BranchRecord } from './types';
import { normalizeEgyptianDisplayPhone } from './branchDisplayIdentity';
import { invalidatePublicSettingsCache } from '@/lib/publicBookingHelpers';

export type UpdateBranchSetupInput = {
  branchId: number;
  address?: string | null;
  phone?: string | null;
  timeZone?: string;
  defaultOpenTime?: string | null;
  defaultCloseTime?: string | null;
  businessDayCutoffTime?: string | null;
  /** When true, refuse non-SETUP targets. Default true for Phase 1O safety. */
  requireSetupLifecycle?: boolean;
  actorUserId?: number | null;
  reason?: string;
};

function toSqlTime(value: string | null | undefined): string | null {
  if (value == null || value === '') return null;
  const v = String(value).trim();
  if (/^\d{2}:\d{2}$/.test(v)) return `${v}:00`;
  if (/^\d{2}:\d{2}:\d{2}$/.test(v)) return v;
  throw new BranchDomainError('OPERATION_NOT_ALLOWED', `Invalid time value: ${value}`, 400);
}

export async function updateBranchSetupFields(
  input: UpdateBranchSetupInput,
): Promise<BranchRecord> {
  const requireSetup = input.requireSetupLifecycle !== false;
  const before = await getBranchById(input.branchId);
  if (!before) {
    throw new BranchDomainError('BRANCH_NOT_FOUND', 'الفرع غير موجود', 404);
  }
  if (requireSetup && before.lifecycleStatus !== 'SETUP') {
    throw new BranchDomainError(
      'BRANCH_LIFECYCLE_FORBIDDEN',
      `تحديث الإعداد مسموح فقط أثناء SETUP (الحالي ${before.lifecycleStatus})`,
      403,
    );
  }

  const phone =
    input.phone === undefined
      ? undefined
      : input.phone == null
        ? null
        : normalizeEgyptianDisplayPhone(input.phone);

  const db = await getPool();
  await db
    .request()
    .input('branchId', sql.Int, input.branchId)
    .input('address', sql.NVarChar(250), input.address === undefined ? null : input.address)
    .input('setAddress', sql.Bit, input.address !== undefined ? 1 : 0)
    .input('phone', sql.NVarChar(40), phone === undefined ? null : phone)
    .input('setPhone', sql.Bit, input.phone !== undefined ? 1 : 0)
    .input('tz', sql.NVarChar(64), input.timeZone ?? null)
    .input('setTz', sql.Bit, input.timeZone !== undefined ? 1 : 0)
    .input('openT', sql.VarChar(8), toSqlTime(input.defaultOpenTime ?? null))
    .input('setOpen', sql.Bit, input.defaultOpenTime !== undefined ? 1 : 0)
    .input('closeT', sql.VarChar(8), toSqlTime(input.defaultCloseTime ?? null))
    .input('setClose', sql.Bit, input.defaultCloseTime !== undefined ? 1 : 0)
    .input('cutoff', sql.VarChar(8), toSqlTime(input.businessDayCutoffTime ?? null))
    .input('setCutoff', sql.Bit, input.businessDayCutoffTime !== undefined ? 1 : 0)
    .query(`
      UPDATE dbo.TblBranch
      SET
        Address = CASE WHEN @setAddress = 1 THEN @address ELSE Address END,
        Phone = CASE WHEN @setPhone = 1 THEN @phone ELSE Phone END,
        TimeZone = CASE WHEN @setTz = 1 THEN @tz ELSE TimeZone END,
        DefaultOpenTime = CASE WHEN @setOpen = 1 THEN CAST(@openT AS time) ELSE DefaultOpenTime END,
        DefaultCloseTime = CASE WHEN @setClose = 1 THEN CAST(@closeT AS time) ELSE DefaultCloseTime END,
        BusinessDayCutoffTime = CASE WHEN @setCutoff = 1 THEN CAST(@cutoff AS time) ELSE BusinessDayCutoffTime END,
        UpdatedAt = SYSUTCDATETIME()
      WHERE BranchID = @branchId
    `);

  await db
    .request()
    .input('branchId', sql.Int, input.branchId)
    .input('actor', sql.Int, input.actorUserId ?? null)
    .input('reason', sql.NVarChar(250), input.reason ?? 'Phase 1O updateBranchSetupFields')
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

  invalidatePublicSettingsCache(input.branchId);

  if (
    input.defaultOpenTime !== undefined ||
    input.defaultCloseTime !== undefined
  ) {
    void import('@/lib/booking/cache/hotCacheInvalidateBestEffort')
      .then((m) =>
        m.notifyHotBranchHours({
          branchId: input.branchId,
          reason: 'branch_regular_hours',
        }),
      )
      .catch(() => undefined);
  }

  const after = await getBranchById(input.branchId);
  if (!after) {
    throw new BranchDomainError('BRANCH_NOT_FOUND', 'الفرع غير موجود بعد التحديث', 500);
  }
  return after;
}
