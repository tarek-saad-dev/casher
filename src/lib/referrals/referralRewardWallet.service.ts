import 'server-only';
import { getPool, sql } from '@/lib/db';
import { ReferralCheckoutError } from './referralCheckoutPolicy';

export type ReferralWalletVoucher = {
  voucherId: number;
  discountPercent: 20;
  issuedAtUtc: string;
  expiresAtUtc: string | null;
};

export async function listTenantReferralRewardWallet(input: {
  tenantId: string;
  clientId: number;
}): Promise<ReferralWalletVoucher[]> {
  if (!Number.isSafeInteger(input.clientId) || input.clientId <= 0 ||
      input.clientId > 2_147_483_647) {
    throw new ReferralCheckoutError('REFERRAL_CLIENT_REQUIRED', 'عميل غير صالح', 400);
  }
  const db = await getPool();
  const ready = await db.request().query(`
    SELECT CASE WHEN OBJECT_ID(N'dbo.TblReferralDiscountVoucher', N'U') IS NOT NULL
      AND OBJECT_ID(N'dbo.TblReferralVisitClaim', N'U') IS NOT NULL
      THEN 1 ELSE 0 END AS Ready;
  `);
  if (Number(ready.recordset[0]?.Ready) !== 1) {
    throw new ReferralCheckoutError('REFERRAL_SCHEMA_UNAVAILABLE', 'محفظة المكافآت غير متاحة', 503);
  }
  const owned = await db.request()
    .input('tenantId', sql.UniqueIdentifier, input.tenantId)
    .input('clientId', sql.Int, input.clientId)
    .query(`
      SELECT TOP (1) ClientID FROM dbo.TblClient
      WHERE TenantId = @tenantId AND ClientID = @clientId;
    `);
  if (!owned.recordset.length) {
    // Unknown and cross-tenant clients are indistinguishable.
    throw new ReferralCheckoutError('REFERRAL_CLIENT_REQUIRED', 'العميل غير موجود', 404);
  }
  const res = await db.request()
    .input('tenantId', sql.UniqueIdentifier, input.tenantId)
    .input('clientId', sql.Int, input.clientId)
    .query(`
      SELECT TOP (100) v.VoucherID, v.DiscountPercent,
        v.IssuedAtUtc, v.ExpiresAtUtc
      FROM dbo.TblReferralDiscountVoucher v
      INNER JOIN dbo.TblReferralVisitClaim c
        ON c.TenantId = v.TenantId AND c.ClaimID = v.ClaimID
          AND c.ReferrerClientID = v.ReferrerClientID
      WHERE v.TenantId = @tenantId AND v.ReferrerClientID = @clientId
        AND v.Status = N'ACTIVE' AND v.UsedInvID IS NULL
        AND (v.ExpiresAtUtc IS NULL OR v.ExpiresAtUtc > SYSUTCDATETIME())
        AND c.Status = N'APPLIED'
      ORDER BY v.IssuedAtUtc ASC, v.VoucherID ASC;
    `);
  return res.recordset.map((row: Record<string, unknown>) => {
    const id = Number(row.VoucherID);
    if (!Number.isSafeInteger(id) || id < 1 || Number(row.DiscountPercent) !== 20) {
      throw new ReferralCheckoutError('REFERRAL_SCHEMA_UNAVAILABLE', 'بيانات المكافأة غير صالحة', 503);
    }
    const issued = row.IssuedAtUtc instanceof Date
      ? row.IssuedAtUtc : new Date(String(row.IssuedAtUtc));
    const expires = row.ExpiresAtUtc == null ? null :
      row.ExpiresAtUtc instanceof Date ? row.ExpiresAtUtc : new Date(String(row.ExpiresAtUtc));
    if (!Number.isFinite(issued.getTime()) || (expires && !Number.isFinite(expires.getTime()))) {
      throw new ReferralCheckoutError('REFERRAL_SCHEMA_UNAVAILABLE', 'تاريخ المكافأة غير صالح', 503);
    }
    return {
      voucherId: id,
      discountPercent: 20 as const,
      issuedAtUtc: issued.toISOString(),
      expiresAtUtc: expires?.toISOString() ?? null,
    };
  });
}
