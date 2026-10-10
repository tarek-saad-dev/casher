import 'server-only';
import { getPool, sql } from '@/lib/db';
import { ensureQueueBookingSettingsForBranch, grantUserBranchAccess } from '@/lib/branch/bootstrap';
import { provisionBranch } from '@/lib/branch/branchProvisioningService';
import { getBranchByCode } from '@/lib/branch/repository';
import { ensureEmployeeBranchAssignment } from '@/lib/branch/assignmentIntegrity';
import { grantStaffAccessToAllActiveBranches } from '@/lib/branch/userLoginBranch';
import { bookingSettingsValidationError } from '@/lib/booking/bookingSettingsValidation';
import { invalidatePublicBookingServicesCache } from '@/lib/booking/publicBookingServices';
import { invalidatePublicBookingBarbersCache } from '@/lib/booking/publicBookingBarbers';
import { invalidatePublicSettingsCache } from '@/lib/publicBookingHelpers';
import { createTenantEmployee } from '@/lib/hr/tenantEmployeeCreate';
import { createTenantStaffUser } from '@/lib/tenant/tenantStaffUsers';
import { requireMasterDataTenantId } from '@/platform/masterData/tenantScope';
import { assertLegacyBranchInTenant, listTenantLegacyBranchIds } from '@/platform/tenant/tenantContext';
import { TenantOnboardingError } from '../errors';
import {
  DEFAULT_SERVICE_CATEGORY,
  conversationPackForIndustry,
  defaultAcceptsBookings,
  onboardingRoleFor,
} from './plan';
import type { OnboardingRequest, OnboardingStageKey } from './types';

/** Identity of the tenant being set up. Branch codes resolve only to this tenant's Locations. */
export type OnboardingSetupContext = {
  tenantId: string;
  tenantCode: string;
  packCode: string;
  apps: string[];
  ownerUserId: number;
  actorUserId: number;
  branchIds: Map<string, number>;
};

export type StageOutcome = { created: number; existing: number; message?: string };

export type OnboardingStageExecutor = (
  ctx: OnboardingSetupContext,
  req: OnboardingRequest,
) => Promise<StageOutcome>;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function branchIdFor(ctx: OnboardingSetupContext, code: string): number {
  const id = ctx.branchIds.get(String(code).trim().toUpperCase());
  if (id == null) {
    throw new TenantOnboardingError('ONBOARDING_TARGET_INVALID', `Branch ${code} is not a branch of this business`);
  }
  return id;
}

/** Additional branches (the first one is created by the core). SETUP lifecycle, public booking off. */
export const runBranchesStage: OnboardingStageExecutor = async (ctx, req) => {
  const tenantBranchIds = await listTenantLegacyBranchIds(ctx.tenantId);
  let created = 0;
  let existing = 0;
  for (const br of req.branches.slice(1)) {
    const code = br.branchCode.trim().toUpperCase();
    const found = await getBranchByCode(code);
    if (found) {
      if (!tenantBranchIds.has(found.branchId)) {
        throw new TenantOnboardingError('BRANCH_CODE_CONFLICT', `Branch code ${code} is already used`, 409);
      }
      ctx.branchIds.set(code, found.branchId);
      existing += 1;
      continue;
    }
    const timezone = br.timezone?.trim() || req.business.timezone;
    const result = await provisionBranch(
      {
        branchCode: code,
        branchName: br.branchName.trim(),
        shortName: br.shortName,
        address: br.address,
        phone: br.phone,
        timeZone: timezone,
        defaultOpenTime: br.defaultOpenTime || null,
        defaultCloseTime: br.defaultCloseTime || null,
        grantActorAccess: false,
        queueSettings: { salonName: br.branchName.trim(), timezone, currency: req.business.currency },
      },
      { userId: ctx.actorUserId, tenantId: ctx.tenantId },
    );
    ctx.branchIds.set(code, result.branch.branchId);
    await grantUserBranchAccess({
      userId: ctx.ownerUserId,
      branchId: result.branch.branchId,
      canOperate: true,
      canViewReports: true,
      canSwitch: true,
      grantedByUserId: ctx.actorUserId,
      grantReason: 'tenant-onboarding-owner',
    });
    created += 1;
  }
  return { created, existing };
};

/** Tenant-owned services in the tenant's own categories (default: the seeded "خدمات"). */
export const runServicesStage: OnboardingStageExecutor = async (ctx, req) => {
  const tenantId = requireMasterDataTenantId(ctx.tenantId, 'onboarding services');
  const pool = await getPool();
  const categoryIds = new Map<string, number>();
  const categoryFor = async (name: string): Promise<number> => {
    const cached = categoryIds.get(name);
    if (cached != null) return cached;
    const params = () =>
      pool.request().input('tenantId', sql.UniqueIdentifier, tenantId).input('catName', sql.NVarChar(100), name);
    await params().query(`
      IF NOT EXISTS (SELECT CatID FROM dbo.TblCat WHERE TenantId = @tenantId AND CatName = @catName)
        INSERT INTO dbo.TblCat (TenantId, CatName) VALUES (@tenantId, @catName);
    `);
    const row = (await params().query(`SELECT CatID FROM dbo.TblCat WHERE TenantId = @tenantId AND CatName = @catName;`))
      .recordset[0] as { CatID: number } | undefined;
    if (!row) throw new Error(`Service category ${name} could not be created`);
    categoryIds.set(name, Number(row.CatID));
    return Number(row.CatID);
  };

  let created = 0;
  let existing = 0;
  for (const s of req.services) {
    const name = s.name.trim();
    const dup = await pool
      .request()
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('proName', sql.NVarChar(200), name)
      .query(`SELECT ProID FROM dbo.TblPro WHERE TenantId = @tenantId AND ProName = @proName;`);
    if (dup.recordset.length) {
      existing += 1;
      continue;
    }
    const catId = await categoryFor(s.categoryName?.trim() || DEFAULT_SERVICE_CATEGORY);
    await pool
      .request()
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('proName', sql.NVarChar(200), name)
      .input('proNameAr', sql.NVarChar(200), s.arabicName?.trim() || null)
      .input('price', sql.Decimal(18, 2), s.price)
      .input('catId', sql.Int, catId)
      .input('isDeleted', sql.Bit, s.active ? 0 : 1)
      .input('duration', sql.Int, s.durationMinutes)
      .query(`
        INSERT INTO dbo.TblPro (TenantId, ProName, ProNameAr, SPrice1, Bonus, CatID, isDeleted, DurationMinutes)
        VALUES (@tenantId, @proName, @proNameAr, @price, 0, @catId, @isDeleted, @duration);
      `);
    created += 1;
  }
  if (created) invalidatePublicBookingServicesCache();
  return { created, existing };
};

/** Tenant employees with a home-branch assignment; payroll/schedule detail stays in HR setup. */
export const runTeamStage: OnboardingStageExecutor = async (ctx, req) => {
  const tenantId = requireMasterDataTenantId(ctx.tenantId, 'onboarding team');
  const pool = await getPool();
  const bookingInstalled = ctx.apps.includes('booking');
  const payrollRelevant = ctx.apps.includes('payroll') || ctx.apps.includes('attendance');
  let created = 0;
  let existing = 0;
  for (const e of req.employees) {
    const name = e.name.trim();
    const branchId = branchIdFor(ctx, e.primaryBranchCode);
    const found = await pool
      .request()
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('empName', sql.NVarChar(200), name)
      .query(`SELECT EmpID FROM dbo.TblEmp WHERE TenantId = @tenantId AND EmpName = @empName;`);
    let empId: number;
    if (found.recordset.length) {
      empId = Number((found.recordset[0] as { EmpID: number }).EmpID);
      existing += 1;
    } else {
      const hr =
        payrollRelevant && e.employmentType && e.payrollMethod
          ? {
              employmentType: e.employmentType,
              payrollMethod: e.payrollMethod,
              ...(e.payrollMethod === 'hourly'
                ? { manualHourlyRate: e.payRate ?? null }
                : e.payrollMethod === 'daily'
                  ? { dailyRate: e.payRate ?? null }
                  : { monthlySalary: e.payRate ?? null }),
            }
          : undefined;
      ({ empId } = await createTenantEmployee({ tenantId, name, job: e.job, isActive: e.active, hr }));
      created += 1;
    }
    await ensureEmployeeBranchAssignment({
      empId,
      branchId,
      effectiveFrom: today(),
      canReceiveBookings: bookingInstalled && (e.acceptsBookings ?? defaultAcceptsBookings(e.job)),
      isHomeBranch: true,
    });
  }
  if (created) invalidatePublicBookingBarbersCache();
  return { created, existing };
};

/** Additional staff users: membership in this tenant only, existing roles, tenant branches only. */
export const runUsersStage: OnboardingStageExecutor = async (ctx, req) => {
  const pool = await getPool();
  let created = 0;
  let existing = 0;
  for (const u of req.users) {
    const role = onboardingRoleFor(u.roleKey);
    if (!role) throw new TenantOnboardingError('OWNER_FIELDS_INVALID', `Unknown role ${u.roleKey}`);
    const loginName = u.loginName.trim();
    const branchId = branchIdFor(ctx, u.defaultBranchCode);

    const found = await pool
      .request()
      .input('loginName', sql.NVarChar(50), loginName)
      .query(`SELECT UserID FROM dbo.TblUser WHERE loginName = @loginName AND ISNULL(isDeleted, 0) = 0;`);
    let userId: number;
    if (found.recordset.length) {
      userId = Number((found.recordset[0] as { UserID: number }).UserID);
      const member = await pool
        .request()
        .input('tenantId', sql.UniqueIdentifier, ctx.tenantId)
        .input('userId', sql.Int, userId)
        .query(`SELECT MembershipId FROM dbo.TenantMembership WHERE TenantId = @tenantId AND LegacyUserId = @userId;`);
      if (!member.recordset.length) {
        throw new TenantOnboardingError('OWNER_USERNAME_CONFLICT', `Login name ${loginName} is already used`, 409);
      }
      existing += 1;
    } else {
      const result = await createTenantStaffUser({
        tenantId: ctx.tenantId,
        userName: u.displayName.trim(),
        loginName,
        password: u.password,
        userLevel: role.userLevel,
        shiftId: 1,
      });
      if (!result.ok) {
        throw new TenantOnboardingError('OWNER_USERNAME_CONFLICT', `Login name ${loginName} is already used`, 409);
      }
      userId = result.user.UserID;
      created += 1;
    }

    const roleRow = await pool
      .request()
      .input('roleKey', sql.NVarChar(50), role.roleKey)
      .query(`SELECT RoleID FROM dbo.TblRoles WHERE RoleKey = @roleKey AND IsActive = 1;`);
    const roleId = (roleRow.recordset[0] as { RoleID: number } | undefined)?.RoleID;
    if (roleId == null) {
      throw new TenantOnboardingError('OWNER_ROLE_MISSING', `Role "${role.roleKey}" is not seeded`, 409);
    }
    await pool
      .request()
      .input('userId', sql.Int, userId)
      .input('roleId', sql.Int, Number(roleId))
      .query(`
        IF NOT EXISTS (SELECT UserID FROM dbo.TblUserRoles WHERE UserID = @userId AND RoleID = @roleId)
          INSERT INTO dbo.TblUserRoles (UserID, RoleID) VALUES (@userId, @roleId);
      `);

    const login = await grantStaffAccessToAllActiveBranches({
      tenantId: ctx.tenantId,
      userId,
      actorUserId: ctx.actorUserId,
      preferredBranchId: branchId,
      grantReason: 'tenant-onboarding-user',
    });
    if (!login.grantedBranchIds.includes(branchId)) {
      await grantUserBranchAccess({
        userId,
        branchId,
        canOperate: true,
        canViewReports: true,
        canSwitch: true,
        grantedByUserId: ctx.actorUserId,
        grantReason: 'tenant-onboarding-user',
      });
    }
  }
  return { created, existing };
};

/** Per-branch booking preferences. Never enables booking or public booking. */
export const runBookingStage: OnboardingStageExecutor = async (ctx, req) => {
  const pool = await getPool();
  let created = 0;
  for (const s of req.booking) {
    const branchId = branchIdFor(ctx, s.branchCode);
    await assertLegacyBranchInTenant(ctx.tenantId, branchId);
    const invalid = bookingSettingsValidationError(s);
    if (invalid) throw new TenantOnboardingError('ONBOARDING_PLAN_INVALID', invalid);
    const branch = req.branches.find((b) => b.branchCode.trim().toUpperCase() === s.branchCode.trim().toUpperCase());
    const timezone = branch?.timezone?.trim() || req.business.timezone;
    const salonName = branch?.branchName.trim() || req.business.businessName.trim();
    await ensureQueueBookingSettingsForBranch(branchId, {
      salonName,
      timezone,
      currency: req.business.currency,
      bookingEnabled: false,
    });
    await pool
      .request()
      .input('branchId', sql.Int, branchId)
      .input('salonName', sql.NVarChar(100), salonName)
      .input('timezone', sql.NVarChar(64), timezone)
      .input('currency', sql.NVarChar(10), req.business.currency)
      .input('defaultMode', sql.NVarChar(20), s.defaultMode)
      .input('slot', sql.Int, s.slotIntervalMinutes)
      .input('minNotice', sql.Int, s.minNoticeMinutes)
      .input('maxDays', sql.Int, s.maxBookingDaysAhead)
      .input('duration', sql.Int, s.defaultServiceDurationMinutes)
      .input('allowSpecific', sql.Bit, s.allowSpecificBarber ? 1 : 0)
      .input('allowNearest', sql.Bit, s.allowNearestBarber ? 1 : 0)
      .query(`
        UPDATE dbo.QueueBookingSettings
        SET SalonName = @salonName, Timezone = @timezone, Currency = @currency,
            DefaultMode = @defaultMode, SlotIntervalMinutes = @slot, MinNoticeMinutes = @minNotice,
            MaxBookingDaysAhead = @maxDays, DefaultServiceDurationMinutes = @duration,
            DefaultServiceMinutes = @duration, AllowSpecificBarber = @allowSpecific,
            AllowNearestBarber = @allowNearest
        WHERE BranchID = @branchId;
      `);
    invalidatePublicSettingsCache(branchId);
    created += 1;
  }
  return { created, existing: 0 };
};

/** AI receptionist profile, saved disabled: it cannot run before the tenant has its own channel. */
export const runAiStage: OnboardingStageExecutor = async (ctx, req) => {
  const ai = req.ai;
  if (!ai) return { created: 0, existing: 0 };
  const pool = await getPool();
  const found = await pool
    .request()
    .input('tenantId', sql.UniqueIdentifier, ctx.tenantId)
    .query(`SELECT TenantId FROM dbo.TenantAiConfig WHERE TenantId = @tenantId;`);
  if (found.recordset.length) {
    return { created: 0, existing: 1, message: 'AI profile already saved' };
  }
  const businessName = ai.businessName.trim();
  const conversationPack = ai.useSalonConciergePack ? conversationPackForIndustry(ctx.packCode) : null;
  const policies = ai.policies.map((p) => p.trim()).filter(Boolean);
  await pool
    .request()
    .input('tenantId', sql.UniqueIdentifier, ctx.tenantId)
    .input('industryCode', sql.NVarChar(64), ctx.packCode)
    .input('businessName', sql.NVarChar(200), businessName)
    .input('persona', sql.NVarChar(400), ai.assistantPersona?.trim() || `موظف استقبال ${businessName}`)
    .input('locale', sql.NVarChar(16), ai.locale.trim())
    .input('websiteUrl', sql.NVarChar(500), ai.websiteUrl?.trim() || null)
    .input('bookingUrl', sql.NVarChar(500), ai.bookingUrl?.trim() || null)
    .input('policies', sql.NVarChar(sql.MAX), policies.length ? JSON.stringify(policies) : null)
    .input('conversationPack', sql.NVarChar(64), conversationPack)
    .query(`
      INSERT INTO dbo.TenantAiConfig (TenantId, Enabled, IndustryCode, BusinessName, AssistantPersona, Locale, WebsiteUrl, BookingUrl, PoliciesJson, ConversationPack)
      VALUES (@tenantId, 0, @industryCode, @businessName, @persona, @locale, @websiteUrl, @bookingUrl, @policies, @conversationPack);
    `);
  return { created: 1, existing: 0, message: 'AI profile saved; it stays off until WhatsApp is connected' };
};

export const DEFAULT_STAGE_EXECUTORS: Record<OnboardingStageKey, OnboardingStageExecutor> = {
  branches: runBranchesStage,
  services: runServicesStage,
  team: runTeamStage,
  users: runUsersStage,
  booking: runBookingStage,
  ai: runAiStage,
};
