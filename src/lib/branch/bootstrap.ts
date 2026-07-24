/**
 * Phase 1G — create / bootstrap a branch for operational readiness.
 * Does not open days/shifts, create payroll, or add a branch switcher.
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import { getBranchByCode, getBranchById, branchNow } from './repository';
import type { BranchRecord } from './types';
import { BranchDomainError } from './types';
import {
  createBranchPartnerSharePeriod,
  getPartnerShareConfigurationTimeline,
  validateBranchPartnerShares,
  GLEEM_PARTNER_SHARE_EFFECTIVE_FROM,
} from './partnerShares';
import { invalidatePublicSettingsCache } from '@/lib/publicBookingHelpers';

export type CreateBranchInput = {
  branchCode: string;
  branchName: string;
  shortName?: string | null;
  address?: string | null;
  phone?: string | null;
  timeZone?: string;
  businessDayCutoffTime?: string; // HH:mm or HH:mm:ss
  defaultOpenTime?: string | null;
  defaultCloseTime?: string | null;
  isActive?: boolean;
  createdByUserId?: number | null;
};

export type SeedQueueSettingsInput = {
  salonName?: string;
  timezone?: string;
  currency?: string;
  bookingEnabled?: boolean;
  allowSpecificBarber?: boolean;
  allowNearestBarber?: boolean;
  defaultMode?: 'nearest' | 'specific';
  slotIntervalMinutes?: number;
  maxBookingDaysAhead?: number;
  minNoticeMinutes?: number;
  defaultServiceDurationMinutes?: number;
  copyFromBranchCode?: string;
};

export type BootstrapBranchOptions = {
  branch: CreateBranchInput;
  seedQueueSettings?: boolean | SeedQueueSettingsInput;
  /** Copy open-ended GLEEM (or source) partner shares onto the new branch. */
  seedPartnerSharesFrom?: string | null;
  partnerShareEffectiveFrom?: string;
};

export type BootstrapBranchResult = {
  branch: BranchRecord;
  queueSettingsCreated: boolean;
  partnerSharesSeeded: number;
};

export type GrantUserBranchAccessInput = {
  userId: number;
  branchId: number;
  canOperate?: boolean;
  canViewReports?: boolean;
  canSwitch?: boolean;
  grantedByUserId?: number | null;
  grantReason?: string | null;
};

export type GrantUserBranchAccessResult = {
  created: boolean;
  reactivated: boolean;
  accessId: number;
};

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function normalizeName(name: string): string {
  return name.trim();
}

function normalizeShortName(shortName: string | null | undefined): string | null {
  if (shortName == null) return null;
  const t = shortName.trim();
  return t.length ? t : null;
}

function toSqlTime(value: string | null | undefined, fallback: string | null): string | null {
  if (value == null || !String(value).trim()) return fallback;
  const v = String(value).trim();
  if (/^\d{2}:\d{2}$/.test(v)) return `${v}:00`;
  if (/^\d{2}:\d{2}:\d{2}$/.test(v)) return v;
  throw new BranchDomainError('BRANCH_INACTIVE', `وقت غير صالح: ${value}`, 400);
}

export async function assertBranchIdentityAvailable(input: {
  branchCode: string;
  branchName: string;
  shortName?: string | null;
  excludeBranchId?: number;
}): Promise<void> {
  const db = await getPool();
  const code = normalizeCode(input.branchCode);
  const name = normalizeName(input.branchName);
  const shortName = normalizeShortName(input.shortName);

  if (!code) {
    throw new BranchDomainError('BRANCH_NOT_FOUND', 'رمز الفرع مطلوب', 400);
  }
  if (!name) {
    throw new BranchDomainError('BRANCH_NOT_FOUND', 'اسم الفرع مطلوب', 400);
  }

  const dup = await db
    .request()
    .input('code', sql.NVarChar(30), code)
    .input('name', sql.NVarChar(100), name)
    .input('shortName', sql.NVarChar(50), shortName)
    .input('excludeId', sql.Int, input.excludeBranchId ?? null)
    .query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.TblBranch
           WHERE BranchCode = @code
             AND (@excludeId IS NULL OR BranchID <> @excludeId)) AS CodeDup,
        (SELECT COUNT(*) FROM dbo.TblBranch
           WHERE BranchName = @name
             AND (@excludeId IS NULL OR BranchID <> @excludeId)) AS NameDup,
        (SELECT COUNT(*) FROM dbo.TblBranch
           WHERE @shortName IS NOT NULL
             AND ShortName = @shortName
             AND (@excludeId IS NULL OR BranchID <> @excludeId)) AS ShortDup
    `);
  const row = dup.recordset[0];
  if (Number(row.CodeDup) > 0) {
    throw new BranchDomainError('BRANCH_NOT_FOUND', `رمز الفرع مستخدم: ${code}`, 409);
  }
  if (Number(row.NameDup) > 0) {
    throw new BranchDomainError('BRANCH_NOT_FOUND', `اسم الفرع مستخدم: ${name}`, 409);
  }
  if (Number(row.ShortDup) > 0) {
    throw new BranchDomainError('BRANCH_NOT_FOUND', `الاسم المختصر مستخدم: ${shortName}`, 409);
  }
}

export async function createBranchRecord(input: CreateBranchInput): Promise<BranchRecord> {
  await assertBranchIdentityAvailable({
    branchCode: input.branchCode,
    branchName: input.branchName,
    shortName: input.shortName,
  });

  const db = await getPool();
  const code = normalizeCode(input.branchCode);
  const name = normalizeName(input.branchName);
  const shortName = normalizeShortName(input.shortName);
  const timeZone = (input.timeZone ?? 'Africa/Cairo').trim() || 'Africa/Cairo';
  const cutoff = toSqlTime(input.businessDayCutoffTime, '04:00:00')!;
  const openT = toSqlTime(input.defaultOpenTime ?? null, null);
  const closeT = toSqlTime(input.defaultCloseTime ?? null, null);
  const isActive = input.isActive !== false;

  const result = await db
    .request()
    .input('code', sql.NVarChar(30), code)
    .input('name', sql.NVarChar(100), name)
    .input('shortName', sql.NVarChar(50), shortName)
    .input('address', sql.NVarChar(250), input.address?.trim() || null)
    .input('phone', sql.NVarChar(30), input.phone?.trim() || null)
    .input('tz', sql.NVarChar(64), timeZone)
    .input('cutoff', sql.NVarChar(8), cutoff)
    .input('openT', sql.NVarChar(8), openT)
    .input('closeT', sql.NVarChar(8), closeT)
    .input('isActive', sql.Bit, isActive ? 1 : 0)
    .input('createdBy', sql.Int, input.createdByUserId ?? null)
    .query(`
      INSERT INTO dbo.TblBranch (
        BranchCode, BranchName, ShortName, Address, Phone,
        TimeZone, BusinessDayCutoffTime, DefaultOpenTime, DefaultCloseTime,
        IsActive, CreatedByUserID
      )
      OUTPUT INSERTED.BranchID
      VALUES (
        @code, @name, @shortName, @address, @phone,
        @tz, CAST(@cutoff AS time(0)),
        CASE WHEN @openT IS NULL THEN NULL ELSE CAST(@openT AS time(0)) END,
        CASE WHEN @closeT IS NULL THEN NULL ELSE CAST(@closeT AS time(0)) END,
        @isActive, @createdBy
      )
    `);

  const id = Number(result.recordset[0].BranchID);
  const branch = await getBranchById(id);
  if (!branch) {
    throw new BranchDomainError('BRANCH_NOT_FOUND', 'فشل إنشاء الفرع', 500);
  }
  return branch;
}

/**
 * Ensure one QueueBookingSettings row for the branch.
 * Copies values from copyFromBranchCode when provided; otherwise inserts defaults.
 */
export async function ensureQueueBookingSettingsForBranch(
  branchId: number,
  options: SeedQueueSettingsInput = {},
): Promise<{ created: boolean }> {
  const db = await getPool();
  const existing = await db
    .request()
    .input('branchId', sql.Int, branchId)
    .query(`
      SELECT TOP 1 SettingID FROM dbo.QueueBookingSettings WHERE BranchID = @branchId
    `);
  if (existing.recordset.length) {
    return { created: false };
  }

  let template: Record<string, unknown> | null = null;
  const copyFrom = options.copyFromBranchCode?.trim();
  if (copyFrom) {
    const src = await getBranchByCode(copyFrom);
    if (!src) {
      throw new BranchDomainError('BRANCH_NOT_FOUND', `فرع المصدر غير موجود: ${copyFrom}`, 404);
    }
    const srcRow = await db
      .request()
      .input('branchId', sql.Int, src.branchId)
      .query(`SELECT TOP 1 * FROM dbo.QueueBookingSettings WHERE BranchID = @branchId`);
    template = (srcRow.recordset[0] as Record<string, unknown>) ?? null;
  }

  const salonName =
    options.salonName ??
    (template?.SalonName != null ? String(template.SalonName) : 'Cut Salon');
  const timezone =
    options.timezone ??
    (template?.Timezone != null ? String(template.Timezone) : 'Africa/Cairo');
  const currency =
    options.currency ?? (template?.Currency != null ? String(template.Currency) : 'EGP');
  const bookingEnabled =
    options.bookingEnabled ??
    (template?.BookingEnabled != null ? Boolean(template.BookingEnabled) : true);
  const allowSpecific =
    options.allowSpecificBarber ??
    (template?.AllowSpecificBarber != null ? Boolean(template.AllowSpecificBarber) : true);
  const allowNearest =
    options.allowNearestBarber ??
    (template?.AllowNearestBarber != null ? Boolean(template.AllowNearestBarber) : true);
  const defaultMode =
    options.defaultMode ??
    (template?.DefaultMode === 'specific' ? 'specific' : 'nearest');
  const slotInterval =
    options.slotIntervalMinutes ??
    (template?.SlotIntervalMinutes != null ? Number(template.SlotIntervalMinutes) : 15);
  const maxDays =
    options.maxBookingDaysAhead ??
    (template?.MaxBookingDaysAhead != null ? Number(template.MaxBookingDaysAhead) : 14);
  const minNotice =
    options.minNoticeMinutes ??
    (template?.MinNoticeMinutes != null ? Number(template.MinNoticeMinutes) : 30);
  const defaultDur =
    options.defaultServiceDurationMinutes ??
    (template?.DefaultServiceDurationMinutes != null
      ? Number(template.DefaultServiceDurationMinutes)
      : template?.DefaultServiceMinutes != null
        ? Number(template.DefaultServiceMinutes)
        : 30);

  await db
    .request()
    .input('branchId', sql.Int, branchId)
    .input('salonName', sql.NVarChar(100), salonName)
    .input('timezone', sql.NVarChar(64), timezone)
    .input('currency', sql.NVarChar(10), currency)
    .input('bookingEnabled', sql.Bit, bookingEnabled ? 1 : 0)
    .input('allowSpecific', sql.Bit, allowSpecific ? 1 : 0)
    .input('allowNearest', sql.Bit, allowNearest ? 1 : 0)
    .input('defaultMode', sql.NVarChar(20), defaultMode)
    .input('slotInterval', sql.Int, slotInterval)
    .input('maxDays', sql.Int, maxDays)
    .input('minNotice', sql.Int, minNotice)
    .input('defaultDur', sql.Int, defaultDur)
    .query(`
      INSERT INTO dbo.QueueBookingSettings (
        BranchID, SalonName, Timezone, Currency, BookingEnabled,
        AllowSpecificBarber, AllowNearestBarber, DefaultMode,
        SlotIntervalMinutes, MaxBookingDaysAhead, MinNoticeMinutes,
        DefaultServiceDurationMinutes, DefaultServiceMinutes
      )
      VALUES (
        @branchId, @salonName, @timezone, @currency, @bookingEnabled,
        @allowSpecific, @allowNearest, @defaultMode,
        @slotInterval, @maxDays, @minNotice,
        @defaultDur, @defaultDur
      )
    `);

  invalidatePublicSettingsCache(branchId);
  return { created: true };
}

export async function seedPartnerSharesFromSourceBranch(args: {
  targetBranchId: number;
  sourceBranchCode: string;
  effectiveFrom?: string;
}): Promise<number> {
  const source = await getBranchByCode(args.sourceBranchCode);
  if (!source) {
    throw new BranchDomainError(
      'BRANCH_NOT_FOUND',
      `فرع نسب الشركاء غير موجود: ${args.sourceBranchCode}`,
      404,
    );
  }
  const asOf = args.effectiveFrom ?? branchNow().toISOString().slice(0, 10);
  const timeline = await getPartnerShareConfigurationTimeline(source.branchId);
  const open = timeline.filter(
    (r) =>
      r.isActive &&
      r.effectiveFrom <= asOf &&
      (r.effectiveTo == null || r.effectiveTo >= asOf),
  );
  if (!open.length) {
    throw new BranchDomainError(
      'BRANCH_NOT_FOUND',
      `لا توجد نسب شركاء فعالة على ${args.sourceBranchCode}`,
      400,
    );
  }

  let seeded = 0;
  const effectiveFrom = args.effectiveFrom ?? GLEEM_PARTNER_SHARE_EFFECTIVE_FROM;
  for (const row of open) {
    await createBranchPartnerSharePeriod({
      branchId: args.targetBranchId,
      partnerCode: row.partnerCode,
      partnerName: row.partnerName,
      sharePercent: row.sharePercent,
      effectiveFrom,
      effectiveTo: null,
      partnerUserId: row.partnerUserId,
      notes: `Seeded from ${args.sourceBranchCode} (Phase 1G)`,
    });
    seeded += 1;
  }
  await validateBranchPartnerShares(args.targetBranchId, effectiveFrom);
  return seeded;
}

/**
 * Grant a user access to operate/view-reports on a branch, without touching
 * IsDefault (never steals the GLEEM default login branch). Idempotent: a
 * currently-valid row for (userId, branchId) is left untouched.
 */
export async function grantUserBranchAccess(
  input: GrantUserBranchAccessInput,
): Promise<GrantUserBranchAccessResult> {
  const db = await getPool();
  const canOperate = input.canOperate !== false;
  const canViewReports = input.canViewReports !== false;
  const canSwitch = input.canSwitch === true;
  const now = branchNow();

  const existing = await db
    .request()
    .input('userId', sql.Int, input.userId)
    .input('branchId', sql.Int, input.branchId)
    .query(`
      SELECT ID, IsActive, ValidFrom, ValidTo
      FROM dbo.TblUserBranchAccess
      WHERE UserID = @userId AND BranchID = @branchId
    `);

  if (existing.recordset.length) {
    const row = existing.recordset[0];
    const validFrom = row.ValidFrom instanceof Date ? row.ValidFrom : new Date(String(row.ValidFrom));
    const validTo =
      row.ValidTo == null
        ? null
        : row.ValidTo instanceof Date
          ? row.ValidTo
          : new Date(String(row.ValidTo));
    const isCurrentlyValid =
      Boolean(row.IsActive) &&
      validFrom.getTime() <= now.getTime() &&
      (validTo == null || validTo.getTime() > now.getTime());

    if (isCurrentlyValid) {
      return { created: false, reactivated: false, accessId: Number(row.ID) };
    }

    await db
      .request()
      .input('id', sql.BigInt, row.ID)
      .input('canOperate', sql.Bit, canOperate ? 1 : 0)
      .input('canViewReports', sql.Bit, canViewReports ? 1 : 0)
      .input('canSwitch', sql.Bit, canSwitch ? 1 : 0)
      .input('now', sql.DateTime2, now)
      .query(`
        UPDATE dbo.TblUserBranchAccess
        SET IsActive = 1,
            CanOperate = @canOperate,
            CanViewReports = @canViewReports,
            CanSwitch = @canSwitch,
            ValidFrom = @now,
            ValidTo = NULL,
            UpdatedAt = SYSUTCDATETIME()
        WHERE ID = @id
      `);
    return { created: false, reactivated: true, accessId: Number(row.ID) };
  }

  const inserted = await db
    .request()
    .input('userId', sql.Int, input.userId)
    .input('branchId', sql.Int, input.branchId)
    .input('canOperate', sql.Bit, canOperate ? 1 : 0)
    .input('canViewReports', sql.Bit, canViewReports ? 1 : 0)
    .input('canSwitch', sql.Bit, canSwitch ? 1 : 0)
    .input('now', sql.DateTime2, now)
    .input('grantedBy', sql.Int, input.grantedByUserId ?? null)
    .input('reason', sql.NVarChar(250), input.grantReason ?? 'Phase 1G bootstrap grant')
    .query(`
      INSERT INTO dbo.TblUserBranchAccess (
        UserID, BranchID, IsDefault, CanOperate, CanViewReports, CanSwitch,
        IsActive, ValidFrom, ValidTo, GrantedByUserID, GrantReason
      )
      OUTPUT INSERTED.ID
      VALUES (
        @userId, @branchId, 0, @canOperate, @canViewReports, @canSwitch,
        1, @now, NULL, @grantedBy, @reason
      )
    `);
  return { created: true, reactivated: false, accessId: Number(inserted.recordset[0].ID) };
}

/**
 * One-command operational bootstrap for a new branch.
 */
export async function bootstrapBranch(
  options: BootstrapBranchOptions,
): Promise<BootstrapBranchResult> {
  const existing = await getBranchByCode(options.branch.branchCode);
  let branch: BranchRecord;
  if (existing) {
    branch = existing;
  } else {
    branch = await createBranchRecord(options.branch);
  }

  let queueSettingsCreated = false;
  const seedSettings = options.seedQueueSettings !== false;
  if (seedSettings) {
    const settingsOpts: SeedQueueSettingsInput =
      typeof options.seedQueueSettings === 'object'
        ? options.seedQueueSettings
        : { copyFromBranchCode: 'GLEEM' };
    if (!settingsOpts.copyFromBranchCode) {
      settingsOpts.copyFromBranchCode = 'GLEEM';
    }
    const ens = await ensureQueueBookingSettingsForBranch(branch.branchId, settingsOpts);
    queueSettingsCreated = ens.created;
  }

  let partnerSharesSeeded = 0;
  if (options.seedPartnerSharesFrom) {
    partnerSharesSeeded = await seedPartnerSharesFromSourceBranch({
      targetBranchId: branch.branchId,
      sourceBranchCode: options.seedPartnerSharesFrom,
      effectiveFrom: options.partnerShareEffectiveFrom,
    });
  }

  return { branch, queueSettingsCreated, partnerSharesSeeded };
}
