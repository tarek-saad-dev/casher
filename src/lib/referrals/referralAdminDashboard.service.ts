import 'server-only';

import { getPool, sql } from '@/lib/db';
import { ReferralCheckoutError } from './referralCheckoutPolicy';

export type ReferralAdminView = 'claims' | 'codes';
export type ReferralAdminFilter =
  | 'all' | 'APPLIED' | 'REVERSED' | 'PENDING' | 'CANCELLED'
  | 'active' | 'inactive';

export type ReferralAdminParams = {
  tenantId: string;
  view: ReferralAdminView;
  status: ReferralAdminFilter;
  page: number;
  search: string;
};

export type ReferralAdminSummary = {
  issuedCodes: number;
  activeCodes: number;
  successfulReferrals: number;
  refundedReferrals: number;
  rewardsIssued: number;
  rewardsAvailable: number;
  rewardsUsed: number;
};

export type ReferralAdminClaim = {
  id: number;
  code: string;
  referrerName: string;
  referredName: string;
  status: 'APPLIED' | 'REVERSED' | 'PENDING' | 'CANCELLED';
  originalInvoiceId: number | null;
  claimedAtUtc: string;
  appliedAtUtc: string | null;
  reversedAtUtc: string | null;
  rewardStatus: 'ACTIVE' | 'USED' | 'EXPIRED' | 'REVOKED' | null;
};

export type ReferralAdminCode = {
  id: number;
  code: string;
  customerName: string;
  activatedAtUtc: string | null;
  createdAtUtc: string;
  referrals: number;
  refunded: number;
  availableRewards: number;
  usedRewards: number;
};

export type ReferralAdminDashboard = {
  summary: ReferralAdminSummary;
  view: ReferralAdminView;
  status: ReferralAdminFilter;
  search: string;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  claims: ReferralAdminClaim[];
  codes: ReferralAdminCode[];
};

export const REFERRAL_ADMIN_PAGE_SIZE = 20;

export function referralAdminDashboardEnabled(): boolean {
  return process.env.POS_REFERRAL_ADMIN_ENABLED === 'true';
}

/** Strictly bounded query, no dynamic SQL from caller controlled search/status. */
export function parseReferralAdminQuery(url: URL): Omit<ReferralAdminParams, 'tenantId'> {
  const rawView = url.searchParams.get('view') ?? 'claims';
  if (rawView !== 'claims' && rawView !== 'codes') {
    throw new ReferralCheckoutError('REFERRAL_NOT_ELIGIBLE', 'قسم غير صالح', 400);
  }
  const view: ReferralAdminView = rawView;
  const status = url.searchParams.get('status') ?? 'all';
  const valid = view === 'claims'
    ? ['all', 'APPLIED', 'REVERSED', 'PENDING', 'CANCELLED']
    : ['all', 'active', 'inactive'];
  if (!valid.includes(status)) {
    throw new ReferralCheckoutError('REFERRAL_NOT_ELIGIBLE', 'فلتر غير صالح', 400);
  }
  const rawPage = url.searchParams.get('page') ?? '1';
  if (!/^[1-9][0-9]*$/.test(rawPage)) {
    throw new ReferralCheckoutError('REFERRAL_NOT_ELIGIBLE', 'رقم الصفحة غير صالح', 400);
  }
  const page = Number(rawPage);
  if (!Number.isSafeInteger(page) || page > 10000) {
    throw new ReferralCheckoutError('REFERRAL_NOT_ELIGIBLE', 'رقم الصفحة غير صالح', 400);
  }
  const search = (url.searchParams.get('search') ?? '').trim();
  if (search.length > 80 || /[\u0000-\u001F\u007F]/.test(search)) {
    throw new ReferralCheckoutError('REFERRAL_NOT_ELIGIBLE', 'البحث غير صالح', 400);
  }
  return { view, status: status as ReferralAdminFilter, page, search };
}

function count(value: unknown): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new ReferralCheckoutError('REFERRAL_SCHEMA_UNAVAILABLE',
      'بيانات تقرير الإحالات غير صالحة', 503);
  }
  return result;
}
function rowId(value: unknown): number {
  const result = count(value);
  if (result < 1) {
    throw new ReferralCheckoutError('REFERRAL_SCHEMA_UNAVAILABLE',
      'معرّف إحالة غير صالح', 503);
  }
  return result;
}
function date(value: unknown): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(d.getTime())) {
    throw new ReferralCheckoutError('REFERRAL_SCHEMA_UNAVAILABLE',
      'تاريخ إحالة غير صالح', 503);
  }
  return d.toISOString();
}
function name(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ReferralCheckoutError('REFERRAL_SCHEMA_UNAVAILABLE',
      'اسم عميل غير صالح', 503);
  }
  return value;
}
function code(value: unknown): string {
  if (typeof value !== 'string' || !/^CUT-[0-9A-F]{24}$/.test(value)) {
    throw new ReferralCheckoutError('REFERRAL_SCHEMA_UNAVAILABLE',
      'كود إحالة غير صالح', 503);
  }
  return value;
}
function claimStatus(value: unknown): ReferralAdminClaim['status'] {
  if (value === 'APPLIED' || value === 'REVERSED' ||
      value === 'PENDING' || value === 'CANCELLED') return value;
  throw new ReferralCheckoutError('REFERRAL_SCHEMA_UNAVAILABLE', 'حالة إحالة غير صالحة', 503);
}
function rewardStatus(value: unknown): ReferralAdminClaim['rewardStatus'] {
  if (value === null || value === undefined) return null;
  if (value === 'ACTIVE' || value === 'USED' ||
      value === 'EXPIRED' || value === 'REVOKED') return value;
  throw new ReferralCheckoutError('REFERRAL_SCHEMA_UNAVAILABLE', 'حالة مكافأة غير صالحة', 503);
}

/**
 * Aggregate summary plus exactly one bounded page of records. No mock values,
 * no legacy coin tables, no invoices/discounts modified, and no telephone/PII.
 * Every customer/voucher join includes the session-derived tenantId.
 */
export async function getTenantReferralAdminDashboard(
  input: ReferralAdminParams,
): Promise<ReferralAdminDashboard> {
  if (!referralAdminDashboardEnabled()) {
    throw new ReferralCheckoutError('REFERRALS_DISABLED',
      'لوحة الإحالات غير مفعلة حاليًا', 503);
  }
  if (!input.tenantId) {
    throw new ReferralCheckoutError('REFERRAL_NOT_ELIGIBLE', 'المنشأة غير محددة', 403);
  }
  if (!['claims', 'codes'].includes(input.view) ||
      !Number.isInteger(input.page) || input.page < 1 || input.page > 10000 ||
      input.search.length > 80) {
    throw new ReferralCheckoutError('REFERRAL_NOT_ELIGIBLE', 'طلب تقرير غير صالح', 400);
  }
  const db = await getPool();
  const ready = await db.request().query(`
    SELECT CASE WHEN OBJECT_ID(N'dbo.TblReferralCustomerCode', N'U') IS NOT NULL
      AND OBJECT_ID(N'dbo.TblReferralVisitClaim', N'U') IS NOT NULL
      AND OBJECT_ID(N'dbo.TblReferralDiscountVoucher', N'U') IS NOT NULL
    THEN 1 ELSE 0 END AS Ready;
  `);
  if (Number(ready.recordset[0]?.Ready) !== 1) {
    throw new ReferralCheckoutError('REFERRAL_SCHEMA_UNAVAILABLE',
      'جداول الإحالات غير جاهزة', 503);
  }

  const summaryResult = await db.request()
    .input('tenantId', sql.UniqueIdentifier, input.tenantId)
    .query(`
      SELECT
        (SELECT COUNT_BIG(*) FROM dbo.TblReferralCustomerCode
          WHERE TenantId = @tenantId) AS IssuedCodes,
        (SELECT COUNT_BIG(*) FROM dbo.TblReferralCustomerCode
          WHERE TenantId = @tenantId AND ActivatedAtUtc IS NOT NULL) AS ActiveCodes,
        (SELECT COUNT_BIG(*) FROM dbo.TblReferralVisitClaim
          WHERE TenantId = @tenantId AND Status = N'APPLIED') AS SuccessfulReferrals,
        (SELECT COUNT_BIG(*) FROM dbo.TblReferralVisitClaim
          WHERE TenantId = @tenantId AND Status = N'REVERSED') AS RefundedReferrals,
        (SELECT COUNT_BIG(*) FROM dbo.TblReferralDiscountVoucher
          WHERE TenantId = @tenantId AND DiscountPercent = 20) AS RewardsIssued,
        (SELECT COUNT_BIG(*) FROM dbo.TblReferralDiscountVoucher
          WHERE TenantId = @tenantId AND DiscountPercent = 20
            AND Status = N'ACTIVE' AND UsedInvID IS NULL
            AND (ExpiresAtUtc IS NULL OR ExpiresAtUtc > SYSUTCDATETIME())) AS RewardsAvailable,
        (SELECT COUNT_BIG(*) FROM dbo.TblReferralDiscountVoucher
          WHERE TenantId = @tenantId AND DiscountPercent = 20
            AND Status = N'USED') AS RewardsUsed;
    `);
  const summary = summaryResult.recordset[0] as Record<string, unknown> | undefined;
  if (!summary) {
    throw new ReferralCheckoutError('REFERRAL_SCHEMA_UNAVAILABLE',
      'تعذر قراءة ملخص الإحالات', 503);
  }
  const converted: ReferralAdminSummary = {
    issuedCodes: count(summary.IssuedCodes),
    activeCodes: count(summary.ActiveCodes),
    successfulReferrals: count(summary.SuccessfulReferrals),
    refundedReferrals: count(summary.RefundedReferrals),
    rewardsIssued: count(summary.RewardsIssued),
    rewardsAvailable: count(summary.RewardsAvailable),
    rewardsUsed: count(summary.RewardsUsed),
  };
  if (converted.activeCodes > converted.issuedCodes ||
      converted.rewardsAvailable + converted.rewardsUsed > converted.rewardsIssued) {
    throw new ReferralCheckoutError('REFERRAL_SCHEMA_UNAVAILABLE',
      'ملخص المكافآت غير متطابق', 503);
  }

  // SQL filters are fixed strings selected below; every input is a parameter.
  const isClaims = input.view === 'claims';
  const filter = isClaims
    ? `(@status = N'all' OR c.Status = @status)
       AND (@search = N'' OR CHARINDEX(@search, referrer.[Name]) > 0
         OR CHARINDEX(@search, referred.[Name]) > 0
         OR CHARINDEX(@search, referralCode.Code) > 0
         OR CONVERT(nvarchar(30), c.ClaimID) = @search)`
    : `(@status = N'all' OR
        (@status = N'active' AND referralCode.ActivatedAtUtc IS NOT NULL) OR
        (@status = N'inactive' AND referralCode.ActivatedAtUtc IS NULL))
       AND (@search = N'' OR CHARINDEX(@search, owner.[Name]) > 0
         OR CHARINDEX(@search, referralCode.Code) > 0
         OR CONVERT(nvarchar(30), owner.ClientID) = @search)`;
  const from = isClaims
    ? `FROM dbo.TblReferralVisitClaim c
       INNER JOIN dbo.TblClient referrer
         ON referrer.TenantId = c.TenantId AND referrer.ClientID = c.ReferrerClientID
       INNER JOIN dbo.TblClient referred
         ON referred.TenantId = c.TenantId AND referred.ClientID = c.ReferredClientID
       INNER JOIN dbo.TblReferralCustomerCode referralCode
         ON referralCode.TenantId = c.TenantId AND referralCode.ReferralCodeID = c.ReferralCodeID
       LEFT JOIN dbo.TblReferralDiscountVoucher v
         ON v.TenantId = c.TenantId AND v.ClaimID = c.ClaimID
           AND v.ReferrerClientID = c.ReferrerClientID
       WHERE c.TenantId = @tenantId AND ${filter}`
    : `FROM dbo.TblReferralCustomerCode referralCode
       INNER JOIN dbo.TblClient owner
         ON owner.TenantId = referralCode.TenantId
           AND owner.ClientID = referralCode.ReferrerClientID
       WHERE referralCode.TenantId = @tenantId AND ${filter}`;
  const withParams = () => db.request()
    .input('tenantId', sql.UniqueIdentifier, input.tenantId)
    .input('status', sql.NVarChar(20), input.status)
    .input('search', sql.NVarChar(80), input.search);

  const totalResult = await withParams().query(`
    SELECT COUNT_BIG(*) AS Total ${from};
  `);
  const total = count(totalResult.recordset[0]?.Total);
  const offset = (input.page - 1) * REFERRAL_ADMIN_PAGE_SIZE;
  // The list is bounded in SQL; never fetch whole customer/referral ledgers.
  const listQuery = isClaims
    ? `
      SELECT c.ClaimID, referralCode.Code, referrer.[Name] AS ReferrerName,
        referred.[Name] AS ReferredName, c.Status,
        c.FirstPaidInvID, c.ClaimedAtUtc, c.AppliedAtUtc, c.ReversedAtUtc,
        v.Status AS RewardStatus
      ${from}
      ORDER BY c.ClaimedAtUtc DESC, c.ClaimID DESC
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
    `
    : `
      SELECT referralCode.ReferralCodeID, referralCode.Code,
        owner.[Name] AS CustomerName, referralCode.ActivatedAtUtc, referralCode.CreatedAtUtc,
        (SELECT COUNT_BIG(*) FROM dbo.TblReferralVisitClaim c
          WHERE c.TenantId = @tenantId AND c.ReferrerClientID = owner.ClientID
            AND c.Status IN (N'APPLIED', N'REVERSED')) AS Referrals,
        (SELECT COUNT_BIG(*) FROM dbo.TblReferralVisitClaim c
          WHERE c.TenantId = @tenantId AND c.ReferrerClientID = owner.ClientID
            AND c.Status = N'REVERSED') AS Refunded,
        (SELECT COUNT_BIG(*) FROM dbo.TblReferralDiscountVoucher v
          WHERE v.TenantId = @tenantId AND v.ReferrerClientID = owner.ClientID
            AND v.Status = N'ACTIVE' AND v.UsedInvID IS NULL
            AND (v.ExpiresAtUtc IS NULL OR v.ExpiresAtUtc > SYSUTCDATETIME())) AS AvailableRewards,
        (SELECT COUNT_BIG(*) FROM dbo.TblReferralDiscountVoucher v
          WHERE v.TenantId = @tenantId AND v.ReferrerClientID = owner.ClientID
            AND v.Status = N'USED') AS UsedRewards
      ${from}
      ORDER BY referralCode.CreatedAtUtc DESC, referralCode.ReferralCodeID DESC
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
    `;
  const pageResult = await withParams()
    .input('offset', sql.Int, offset)
    .input('pageSize', sql.Int, REFERRAL_ADMIN_PAGE_SIZE)
    .query(listQuery);
  const claims: ReferralAdminClaim[] = [];
  const codes: ReferralAdminCode[] = [];
  for (const raw of pageResult.recordset as Array<Record<string, unknown>>) {
    if (isClaims) {
      claims.push({
        id: rowId(raw.ClaimID),
        code: code(raw.Code),
        referrerName: name(raw.ReferrerName),
        referredName: name(raw.ReferredName),
        status: claimStatus(raw.Status),
        originalInvoiceId: raw.FirstPaidInvID == null ? null : rowId(raw.FirstPaidInvID),
        claimedAtUtc: date(raw.ClaimedAtUtc)!,
        appliedAtUtc: date(raw.AppliedAtUtc),
        reversedAtUtc: date(raw.ReversedAtUtc),
        rewardStatus: rewardStatus(raw.RewardStatus),
      });
    } else {
      codes.push({
        id: rowId(raw.ReferralCodeID),
        code: code(raw.Code),
        customerName: name(raw.CustomerName),
        activatedAtUtc: date(raw.ActivatedAtUtc),
        createdAtUtc: date(raw.CreatedAtUtc)!,
        referrals: count(raw.Referrals),
        refunded: count(raw.Refunded),
        availableRewards: count(raw.AvailableRewards),
        usedRewards: count(raw.UsedRewards),
      });
    }
  }
  return {
    summary: converted,
    view: input.view,
    status: input.status,
    search: input.search,
    page: input.page,
    pageSize: REFERRAL_ADMIN_PAGE_SIZE,
    total,
    totalPages: Math.ceil(total / REFERRAL_ADMIN_PAGE_SIZE),
    claims,
    codes,
  };
}
