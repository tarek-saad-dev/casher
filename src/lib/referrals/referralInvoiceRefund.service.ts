import 'server-only';
import type { Transaction } from 'mssql';
import { sql } from '@/lib/db';
import { ReferralCheckoutError } from './referralCheckoutPolicy';

/**
 * Approved commercial policy (issue #235):
 * - Referrer keeps the 20% reward even when the referred sale is fully refunded.
 * - When the invoice on which a 20% reward was redeemed is fully refunded, its
 *   reward is returned to ACTIVE, subject to its original expiry.
 * - Both transitions happen inside the SAME audited invoice-DELETE transaction.
 * - No partial refund or direct voucher write is exposed by this service.
 */
export function referralRefundEnabled(): boolean {
  return process.env.POS_REFERRAL_REVERSAL_ENABLED === 'true';
}

export type ReferralInvoiceRefundRecord = {
  claimId: number | null;
  voucherId: number | null;
  /** A refunded referral does not revoke the already-issued reward. */
  rewardPreserved: boolean;
  /** The refunded purchase restores its used voucher, never duplicates it. */
  voucherRestored: boolean;
};

export type ReferralRefundLedgerSnapshot = {
  claimId: number | null;
  claimStatus: string | null;
  issuedRewardId: number | null;
  issuedRewardStatus: string | null;
  redeemedVoucherId: number | null;
  redeemedVoucherStatus: string | null;
};

async function schemaReady(transaction: Transaction): Promise<boolean> {
  const r = await new sql.Request(transaction).query(`
    SELECT
      CASE WHEN OBJECT_ID(N'dbo.TblReferralVisitClaim', N'U') IS NOT NULL
        THEN 1 ELSE 0 END AS HasClaims,
      CASE WHEN OBJECT_ID(N'dbo.TblReferralDiscountVoucher', N'U') IS NOT NULL
        THEN 1 ELSE 0 END AS HasVouchers;
  `);
  const claims = Number(r.recordset[0]?.HasClaims);
  const vouchers = Number(r.recordset[0]?.HasVouchers);
  if (claims === 0 && vouchers === 0) {
    if (referralRefundEnabled()) {
      throw new ReferralCheckoutError(
        'REFERRAL_SCHEMA_UNAVAILABLE', 'جداول الإحالات غير جاهزة للاسترجاع', 503,
      );
    }
    return false; // No referral feature installed yet: legacy delete unchanged.
  }
  if (claims !== 1 || vouchers !== 1) {
    throw new ReferralCheckoutError(
      'REFERRAL_SCHEMA_UNAVAILABLE', 'بيانات الإحالات غير مكتملة', 503,
    );
  }
  return true;
}

async function findLedger(
  transaction: Transaction,
  tenantId: string,
  invoiceId: number,
  lock: boolean,
) {
  const hint = lock ? ' WITH (UPDLOCK, HOLDLOCK)' : '';
  const linked = await new sql.Request(transaction)
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('invId', sql.Int, invoiceId)
    .query(`
      SELECT c.ClaimID, c.Status
      FROM dbo.TblReferralVisitClaim c${hint}
      WHERE c.TenantId = @tenantId AND c.FirstPaidInvID = @invId
        AND c.FirstPaidInvType = N'مبيعات';
    `);
  const redeemed = await new sql.Request(transaction)
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('invId', sql.Int, invoiceId)
    .query(`
      SELECT v.VoucherID, v.Status
      FROM dbo.TblReferralDiscountVoucher v${hint}
      WHERE v.TenantId = @tenantId AND v.UsedInvID = @invId
        AND v.UsedInvType = N'مبيعات';
    `);
  if (linked.recordset.length > 1 || redeemed.recordset.length > 1 ||
      (linked.recordset.length && redeemed.recordset.length)) {
    throw new ReferralCheckoutError('REFERRAL_NOT_ELIGIBLE',
      'الفاتورة مرتبطة بأكثر من حركة إحالة؛ راجع الإدارة قبل الاسترجاع', 409);
  }
  const claim = linked.recordset[0] as { ClaimID: number; Status: string } | undefined;
  const voucher = redeemed.recordset[0] as { VoucherID: number; Status: string } | undefined;
  return { claim, voucher };
}

/**
 * Enrich an existing audited-invoice oldData snapshot with referral source
 * IDs and voucher state. These values are recorded by executeAuditedAction
 * with staff user, reason and old invoice snapshot in the same audit.
 */
export async function getReferralRefundAuditSnapshot(
  transaction: Transaction,
  tenantId: string,
  invoiceId: number,
): Promise<ReferralRefundLedgerSnapshot | null> {
  if (!(await schemaReady(transaction))) return null;
  const { claim, voucher } = await findLedger(transaction, tenantId, invoiceId, false);
  if (!claim && !voucher) return null;
  let rewardId: number | null = null;
  let rewardStatus: string | null = null;
  if (claim) {
    const r = await new sql.Request(transaction)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('claimId', sql.BigInt, claim.ClaimID)
      .query(`
        SELECT VoucherID, Status
        FROM dbo.TblReferralDiscountVoucher
        WHERE TenantId = @tenantId AND ClaimID = @claimId;
      `);
    if (r.recordset.length !== 1) {
      throw new ReferralCheckoutError('REFERRAL_NOT_ELIGIBLE',
        'تعذر توثيق المكافأة المرتبطة بالإحالة', 409);
    }
    rewardId = Number(r.recordset[0].VoucherID);
    rewardStatus = String(r.recordset[0].Status);
  }
  return {
    claimId: claim ? Number(claim.ClaimID) : null,
    claimStatus: claim?.Status ?? null,
    issuedRewardId: rewardId,
    issuedRewardStatus: rewardStatus,
    redeemedVoucherId: voucher ? Number(voucher.VoucherID) : null,
    redeemedVoucherStatus: voucher?.Status ?? null,
  };
}

/**
 * Called in the audited DELETE's execute callback immediately before the
 * existing branch-scoped invoice delete (which reverses stock/treasury).
 * AuditedAction writes the old snapshot and refund reason before COMMIT.
 * Any failure rolls back all referral changes and invoice deletion together.
 */
export async function reverseReferralInvoiceOnFullRefund(
  transaction: Transaction,
  input: { tenantId: string; invoiceId: number },
): Promise<ReferralInvoiceRefundRecord> {
  const noChange: ReferralInvoiceRefundRecord = {
    claimId: null, voucherId: null, rewardPreserved: false, voucherRestored: false,
  };
  if (!Number.isSafeInteger(input.invoiceId) || input.invoiceId <= 0 || !input.tenantId) {
    throw new ReferralCheckoutError('REFERRAL_NOT_ELIGIBLE', 'فاتورة غير صالحة', 400);
  }
  if (!(await schemaReady(transaction))) return noChange;
  const { claim, voucher } = await findLedger(transaction, input.tenantId, input.invoiceId, true);
  if (!claim && !voucher) return noChange;
  if (!referralRefundEnabled()) {
    throw new ReferralCheckoutError('REFERRAL_NOT_ELIGIBLE',
      'الاسترجاع المرتبط بإحالة يحتاج تفعيل ومراجعة سياسة المكافآت', 409);
  }

  // The tenant comes from the staff session; require the invoice's branch to
  // belong to this tenant too. An ownership mismatch never mutates ledger.
  const ownership = await new sql.Request(transaction)
    .input('tenantId', sql.UniqueIdentifier, input.tenantId)
    .input('invId', sql.Int, input.invoiceId)
    .query(`
      SELECT TOP (1) h.invID
      FROM dbo.TblinvServHead h WITH (UPDLOCK, HOLDLOCK)
      INNER JOIN dbo.Location l
        ON l.LegacyBranchId = h.BranchID AND l.TenantId = @tenantId
      WHERE h.invID = @invId AND h.invType = N'مبيعات';
    `);
  if (ownership.recordset.length !== 1) {
    throw new ReferralCheckoutError('REFERRAL_NOT_ELIGIBLE',
      'الفاتورة غير تابعة للمنشأة أو لم تعد موجودة', 404);
  }

  if (claim) {
    if (claim.Status !== 'APPLIED') {
      throw new ReferralCheckoutError('REFERRAL_NOT_ELIGIBLE',
        'حركة الإحالة سبق استرجاعها أو غير قابلة للاسترجاع', 409);
    }
    // Voucher stays ACTIVE or USED. Only source claim history is reversed.
    const reversed = await new sql.Request(transaction)
      .input('tenantId', sql.UniqueIdentifier, input.tenantId)
      .input('invId', sql.Int, input.invoiceId)
      .input('claimId', sql.BigInt, claim.ClaimID)
      .query(`
        UPDATE dbo.TblReferralVisitClaim
        SET Status = N'REVERSED', ReversedAtUtc = SYSUTCDATETIME()
        WHERE TenantId = @tenantId AND ClaimID = @claimId
          AND FirstPaidInvID = @invId AND FirstPaidInvType = N'مبيعات'
          AND Status = N'APPLIED' AND ReversedAtUtc IS NULL;
      `);
    if (reversed.rowsAffected?.[0] !== 1) {
      throw new ReferralCheckoutError('REFERRAL_NOT_ELIGIBLE',
        'الاسترجاع اتنفذ قبل كده أو حالة الإحالة تغيرت', 409);
    }
    return {
      claimId: Number(claim.ClaimID), voucherId: null,
      rewardPreserved: true, voucherRestored: false,
    };
  }

  if (voucher) {
    if (voucher.Status !== 'USED') {
      throw new ReferralCheckoutError('REFERRAL_VOUCHER_UNAVAILABLE',
        'المكافأة مش قابلة للاستعادة أو سبق استرجاعها', 409);
    }
    // Refund of the invoice where reward was USED: return the SINGLE original
    // voucher to wallet, keep original ExpiresAtUtc, and clear usage pointers.
    // No new voucher issuance (so no inflation on retries).
    const restored = await new sql.Request(transaction)
      .input('tenantId', sql.UniqueIdentifier, input.tenantId)
      .input('invId', sql.Int, input.invoiceId)
      .input('voucherId', sql.BigInt, voucher.VoucherID)
      .query(`
        UPDATE dbo.TblReferralDiscountVoucher
        SET Status = N'ACTIVE', UsedAtUtc = NULL,
            UsedInvID = NULL, UsedInvType = NULL
        WHERE TenantId = @tenantId AND VoucherID = @voucherId
          AND UsedInvID = @invId AND UsedInvType = N'مبيعات'
          AND Status = N'USED' AND EXISTS (
            SELECT 1 FROM dbo.TblReferralVisitClaim c
            WHERE c.TenantId = dbo.TblReferralDiscountVoucher.TenantId
              AND c.ClaimID = dbo.TblReferralDiscountVoucher.ClaimID
              AND c.ReferrerClientID = dbo.TblReferralDiscountVoucher.ReferrerClientID
              AND c.Status IN (N'APPLIED', N'REVERSED')
          );
      `);
    if (restored.rowsAffected?.[0] !== 1) {
      throw new ReferralCheckoutError('REFERRAL_VOUCHER_UNAVAILABLE',
        'المكافأة سبق استرجاعها أو تغيرت حالتها', 409);
    }
    return {
      claimId: null, voucherId: Number(voucher.VoucherID),
      rewardPreserved: false, voucherRestored: true,
    };
  }
  return noChange;
}
