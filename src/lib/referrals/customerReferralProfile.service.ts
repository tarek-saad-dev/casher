import 'server-only';
import { getPool, sql } from '@/lib/db';
import { ReferralCheckoutError } from './referralCheckoutPolicy';

export type CustomerReferralProfile = {
  clientId: number;
  /** Null unless a permanent code was activated by a fully paid visit. */
  code: string | null;
  codeActivated: boolean;
  /** APPLIED excludes original invoices fully refunded afterwards. */
  successfulReferrals: number;
  /** REVERSED claims remain reward-eligible under the approved policy. */
  refundedReferrals: number;
  totalRewardedReferrals: number;
  earnedRewards: number;
  availableRewards: number;
  usedRewards: number;
};

const CODE_PATTERN = /^CUT-[0-9A-F]{24}$/;

/** Server switch is independent from the browser feature flag. */
export function customerReferralProfileEnabled(): boolean {
  return process.env.POS_REFERRAL_PROFILE_ENABLED === 'true';
}

function safeCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new ReferralCheckoutError(
      'REFERRAL_SCHEMA_UNAVAILABLE', 'تعذر قراءة إحصائيات الإحالات', 503,
    );
  }
  return n;
}

/**
 * Authenticated cashier's tenant ONLY. No customer phone, name, or personal
 * data is emitted. All facts are read-only; no code/reward can be created by
 * opening this profile. The public/client/referral development stub is NOT used.
 */
export async function getTenantCustomerReferralProfile(input: {
  tenantId: string;
  clientId: number;
}): Promise<CustomerReferralProfile> {
  if (!customerReferralProfileEnabled()) {
    throw new ReferralCheckoutError('REFERRALS_DISABLED', 'ملف الإحالات غير متاح حاليًا', 503);
  }
  if (!Number.isSafeInteger(input.clientId) || input.clientId <= 0 ||
      input.clientId > 2_147_483_647) {
    throw new ReferralCheckoutError('REFERRAL_CLIENT_REQUIRED', 'عميل غير صالح', 400);
  }

  const db = await getPool();
  const schema = await db.request().query(`
    SELECT CASE WHEN
      OBJECT_ID(N'dbo.TblReferralCustomerCode', N'U') IS NOT NULL
      AND OBJECT_ID(N'dbo.TblReferralVisitClaim', N'U') IS NOT NULL
      AND OBJECT_ID(N'dbo.TblReferralDiscountVoucher', N'U') IS NOT NULL
    THEN 1 ELSE 0 END AS Ready;
  `);
  if (Number(schema.recordset[0]?.Ready) !== 1) {
    throw new ReferralCheckoutError('REFERRAL_SCHEMA_UNAVAILABLE',
      'جداول الإحالات غير متاحة', 503);
  }

  // A missing or foreign-tenant client produces the same 404, and no stats or
  // referral code queries run until this check succeeds.
  const ownership = await db.request()
    .input('tenantId', sql.UniqueIdentifier, input.tenantId)
    .input('clientId', sql.Int, input.clientId)
    .query(`
      SELECT TOP (1) ClientID
      FROM dbo.TblClient
      WHERE TenantId = @tenantId AND ClientID = @clientId;
    `);
  if (ownership.recordset.length !== 1) {
    throw new ReferralCheckoutError('REFERRAL_CLIENT_REQUIRED', 'العميل غير موجود', 404);
  }

  const codeRes = await db.request()
    .input('tenantId', sql.UniqueIdentifier, input.tenantId)
    .input('clientId', sql.Int, input.clientId)
    .query(`
      SELECT Code, ActivatedAtUtc
      FROM dbo.TblReferralCustomerCode
      WHERE TenantId = @tenantId AND ReferrerClientID = @clientId;
    `);
  if (codeRes.recordset.length > 1) {
    throw new ReferralCheckoutError('REFERRAL_SCHEMA_UNAVAILABLE',
      'كود إحالة مكرر؛ يرجى مراجعة الإدارة', 503);
  }
  const current = codeRes.recordset[0] as
    | { Code: unknown; ActivatedAtUtc: unknown }
    | undefined;
  const codeActivated = current?.ActivatedAtUtc != null;
  let code: string | null = null;
  if (codeActivated) {
    if (typeof current?.Code !== 'string' || !CODE_PATTERN.test(current.Code)) {
      throw new ReferralCheckoutError('REFERRAL_SCHEMA_UNAVAILABLE',
        'كود العميل غير صالح؛ يرجى مراجعة الإدارة', 503);
    }
    code = current.Code;
  }

  const claimRes = await db.request()
    .input('tenantId', sql.UniqueIdentifier, input.tenantId)
    .input('clientId', sql.Int, input.clientId)
    .query(`
      SELECT
        COUNT_BIG(*) AS TotalClaims,
        ISNULL(SUM(CASE WHEN Status = N'APPLIED'
          THEN CONVERT(bigint, 1) ELSE CONVERT(bigint, 0) END), 0) AS Successful,
        ISNULL(SUM(CASE WHEN Status = N'REVERSED'
          THEN CONVERT(bigint, 1) ELSE CONVERT(bigint, 0) END), 0) AS Refunded
      FROM dbo.TblReferralVisitClaim
      WHERE TenantId = @tenantId AND ReferrerClientID = @clientId
        AND Status IN (N'APPLIED', N'REVERSED');
    `);
  const counts = claimRes.recordset[0] as
    | { TotalClaims: unknown; Successful: unknown; Refunded: unknown }
    | undefined;
  if (!counts) {
    throw new ReferralCheckoutError('REFERRAL_SCHEMA_UNAVAILABLE',
      'تعذر قراءة سجل الإحالات', 503);
  }
  const successfulReferrals = safeCount(counts.Successful);
  const refundedReferrals = safeCount(counts.Refunded);
  const totalRewardedReferrals = safeCount(counts.TotalClaims);
  if (successfulReferrals + refundedReferrals !== totalRewardedReferrals) {
    throw new ReferralCheckoutError('REFERRAL_SCHEMA_UNAVAILABLE',
      'بيانات الإحالات غير متطابقة', 503);
  }

  // Counts are calculated independently of source claim Status, since the
  // owner-approved refund policy keeps already earned 20% vouchers valid.
  const walletRes = await db.request()
    .input('tenantId', sql.UniqueIdentifier, input.tenantId)
    .input('clientId', sql.Int, input.clientId)
    .query(`
      SELECT
        COUNT_BIG(*) AS Earned,
        ISNULL(SUM(CASE WHEN v.Status = N'ACTIVE'
          AND v.UsedInvID IS NULL
          AND (v.ExpiresAtUtc IS NULL OR v.ExpiresAtUtc > SYSUTCDATETIME())
          THEN CONVERT(bigint, 1) ELSE CONVERT(bigint, 0) END), 0) AS Available,
        ISNULL(SUM(CASE WHEN v.Status = N'USED'
          THEN CONVERT(bigint, 1) ELSE CONVERT(bigint, 0) END), 0) AS Used
      FROM dbo.TblReferralDiscountVoucher v
      INNER JOIN dbo.TblReferralVisitClaim c
        ON c.TenantId = v.TenantId
        AND c.ClaimID = v.ClaimID
        AND c.ReferrerClientID = v.ReferrerClientID
      WHERE v.TenantId = @tenantId
        AND v.ReferrerClientID = @clientId
        AND v.DiscountPercent = 20
        AND c.Status IN (N'APPLIED', N'REVERSED');
    `);
  const wallet = walletRes.recordset[0] as
    | { Earned: unknown; Available: unknown; Used: unknown }
    | undefined;
  if (!wallet) {
    throw new ReferralCheckoutError('REFERRAL_SCHEMA_UNAVAILABLE',
      'تعذر قراءة المكافآت', 503);
  }
  const earnedRewards = safeCount(wallet.Earned);
  const availableRewards = safeCount(wallet.Available);
  const usedRewards = safeCount(wallet.Used);
  if (availableRewards + usedRewards > earnedRewards) {
    throw new ReferralCheckoutError('REFERRAL_SCHEMA_UNAVAILABLE',
      'رصيد المكافآت غير متطابق', 503);
  }

  return {
    clientId: input.clientId,
    code,
    codeActivated,
    successfulReferrals,
    refundedReferrals,
    totalRewardedReferrals,
    earnedRewards,
    availableRewards,
    usedRewards,
  };
}
