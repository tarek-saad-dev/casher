import 'server-only';
import { getPool, sql } from '@/lib/db';
import {
  decideReferralPreview,
  type ReferralPreviewReason,
} from './referralPreviewPolicy';

type Preview = {
  ok: true;
  eligible: boolean;
  discountPercent: 0 | 50;
  reason: ReferralPreviewReason | null;
  previewOnly: true;
};

export class ReferralPreviewUnavailableError extends Error {
  constructor() {
    super('Referral schema is not ready');
    this.name = 'ReferralPreviewUnavailableError';
  }
}

export class ReferralPreviewNotFoundError extends Error {
  constructor() {
    super('Referral code or customer not found');
    this.name = 'ReferralPreviewNotFoundError';
  }
}

/**
 * Staff-only, read-only preview. Never trusts a customer-controlled tenant ID.
 * The tenant ID MUST be sourced from the authenticated staff session.
 *
 * No referral claim, reward issuance or financial mutation occurs here.
 * An eligible preview is not a reservation, nor authorization to discount a
 * sale: the future sale transaction must repeat all checks under locks.
 */
export async function getTenantReferralPreview(input: {
  tenantId: string;
  referredClientId: number;
  code: string;
}): Promise<Preview> {
  const db = await getPool();

  const schema = await db.request().query(`
    SELECT CASE WHEN
      OBJECT_ID(N'dbo.TblReferralCustomerCode', N'U') IS NOT NULL
      AND OBJECT_ID(N'dbo.TblReferralVisitClaim', N'U') IS NOT NULL
      AND OBJECT_ID(N'dbo.TblReferralDiscountVoucher', N'U') IS NOT NULL
    THEN 1 ELSE 0 END AS Ready
  `);
  if (Number(schema.recordset[0]?.Ready) !== 1) {
    throw new ReferralPreviewUnavailableError();
  }

  const referred = await db.request()
    .input('tenantId', sql.UniqueIdentifier, input.tenantId)
    .input('clientId', sql.Int, input.referredClientId)
    .query(`
      SELECT TOP(1) ClientID
      FROM dbo.TblClient
      WHERE TenantId = @tenantId AND ClientID = @clientId
    `);
  if (!referred.recordset.length) throw new ReferralPreviewNotFoundError();

  const matchedCode = await db.request()
    .input('tenantId', sql.UniqueIdentifier, input.tenantId)
    .input('code', sql.NVarChar(32), input.code)
    .query(`
      SELECT TOP(1) ReferrerClientID, ActivatedAtUtc
      FROM dbo.TblReferralCustomerCode
      WHERE TenantId = @tenantId AND Code = @code
    `);
  const owner = matchedCode.recordset[0] as
    | { ReferrerClientID: number; ActivatedAtUtc: Date | null }
    | undefined;
  if (!owner) throw new ReferralPreviewNotFoundError();

  const facts = await db.request()
    .input('tenantId', sql.UniqueIdentifier, input.tenantId)
    .input('referrerId', sql.Int, owner.ReferrerClientID)
    .input('referredId', sql.Int, input.referredClientId)
    .query(`
      SELECT
        CASE WHEN EXISTS (
          SELECT 1 FROM dbo.TblinvServHead h
          INNER JOIN dbo.TblClient c ON c.ClientID = h.ClientID AND c.TenantId = @tenantId
          WHERE h.ClientID = @referrerId AND h.invType = N'مبيعات'
            AND h.GrandTotal > 0 AND h.Payment >= h.GrandTotal
            AND ISNULL(h.PayDue, 0) <= 0 AND ISNULL(h.isActive, N'no') = N'no'
        ) THEN 1 ELSE 0 END AS ReferrerPaid,
        CASE WHEN EXISTS (
          SELECT 1 FROM dbo.TblinvServHead h
          INNER JOIN dbo.TblClient c ON c.ClientID = h.ClientID AND c.TenantId = @tenantId
          WHERE h.ClientID = @referredId AND h.invType = N'مبيعات'
            AND h.GrandTotal > 0 AND h.Payment >= h.GrandTotal
            AND ISNULL(h.PayDue, 0) <= 0 AND ISNULL(h.isActive, N'no') = N'no'
        ) THEN 1 ELSE 0 END AS ReferredPaid,
        CASE WHEN EXISTS (
          SELECT 1 FROM dbo.TblReferralVisitClaim
          WHERE TenantId = @tenantId AND ReferredClientID = @referredId
        ) THEN 1 ELSE 0 END AS HasClaim
    `);
  const row = facts.recordset[0] as
    | { ReferrerPaid: number; ReferredPaid: number; HasClaim: number }
    | undefined;
  // Never fail open if the database did not return the facts.
  if (!row || ![row.ReferrerPaid, row.ReferredPaid, row.HasClaim].every(x => x === 0 || x === 1 || x === false || x === true)) {
    throw new ReferralPreviewUnavailableError();
  }

  const decision = decideReferralPreview({
    referrerClientId: owner.ReferrerClientID,
    referredClientId: input.referredClientId,
    activated: owner.ActivatedAtUtc != null,
    referrerHasPaidVisit: Boolean(row.ReferrerPaid),
    referredHasPaidVisit: Boolean(row.ReferredPaid),
    referredHasClaim: Boolean(row.HasClaim),
  });
  return { ok: true, ...decision, previewOnly: true };
}
