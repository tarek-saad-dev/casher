import 'server-only';

import { randomBytes } from 'node:crypto';
import type { Transaction } from 'mssql';
import { sql } from '@/lib/db';
import { assertReferralCheckoutCatalogPrices } from './referralCatalogPriceGuard';
import {
  ReferralCheckoutError,
  generatePermanentReferralCheckoutCode,
  referralCheckoutEnabled,
  referralRewardRedemptionEnabled,
} from './referralCheckoutPolicy';

type SaleReferralInput = {
  tenantId?: string;
  clientId: number | null;
  referralCode?: string | null;
  referralVoucherId?: number | null;
  items?: Array<{proId:number;sPrice:number;qty:number;bonus:number}>;
};

type ReferralReservation = {
  tenantId: string;
  referredClientId: number;
  referrerClientId: number;
  referralCodeId: number;
  claimId: number;
};

export type ReferralSalePreparation = {
  tenantId: string;
  clientId: number | null;
  reservation: ReferralReservation | null;
  voucherReservation?: { voucherId: number } | null;
};

const FULLY_PAID = `
  h.invType = N'مبيعات'
  AND h.GrandTotal > 0
  AND h.Payment >= h.GrandTotal
  AND ISNULL(h.PayDue, 0) <= 0
  AND ISNULL(h.isActive, N'no') = N'no'
`;

/**
 * Used by BOTH sale writers in the same SERIALIZABLE transaction they commit.
 * All paid-sale writers lock the referred customer row (even for ordinary
 * checkout) so a normal sale cannot race an 'already first visit' referral.
 * Referral validation, reservation, and eventual reward issuance never run
 * on GET/preview or outside this transaction.
 */
export async function prepareReferralSaleTransaction(
  tx: Transaction,
  input: SaleReferralInput,
): Promise<ReferralSalePreparation | null> {
  if (!referralCheckoutEnabled()) {
    // A referral request must NEVER silently proceed as a full-price invoice.
    if (input.referralCode != null || input.referralVoucherId != null) {
      throw new ReferralCheckoutError('REFERRALS_DISABLED', 'خصم الإحالة غير متاح حاليًا');
    }
    return null;
  }
  if (!input.tenantId) {
    throw new ReferralCheckoutError('REFERRAL_NOT_ELIGIBLE', 'تعذر تحديد المنشأة لهذا المستخدم', 403);
  }
  const tenantId = input.tenantId;
  if (input.clientId == null) {
    if (input.referralCode != null || input.referralVoucherId != null) {
      throw new ReferralCheckoutError('REFERRAL_CLIENT_REQUIRED', 'اختار العميل أولًا', 400);
    }
    return { tenantId, clientId: null, reservation: null };
  }
  const readiness = await new sql.Request(tx).query(`
    SELECT CASE WHEN
      OBJECT_ID(N'dbo.TblReferralCustomerCode', N'U') IS NOT NULL
      AND OBJECT_ID(N'dbo.TblReferralVisitClaim', N'U') IS NOT NULL
      AND OBJECT_ID(N'dbo.TblReferralDiscountVoucher', N'U') IS NOT NULL
    THEN 1 ELSE 0 END AS Ready;
  `);
  if (Number(readiness.recordset[0]?.Ready) !== 1) {
    throw new ReferralCheckoutError('REFERRAL_SCHEMA_UNAVAILABLE', 'خدمة الإحالات غير جاهزة', 503);
  }
  const clientId = Number(input.clientId);
  if (!Number.isSafeInteger(clientId) || clientId < 1 || clientId > 2_147_483_647) {
    throw new ReferralCheckoutError('REFERRAL_CLIENT_REQUIRED', 'عميل غير صالح', 400);
  }
  // The customer row is the serial point shared by referral and regular sales.
  const locked = await new sql.Request(tx)
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('clientId', sql.Int, clientId)
    .query(`
      SELECT ClientID FROM dbo.TblClient WITH (UPDLOCK, HOLDLOCK)
      WHERE TenantId = @tenantId AND ClientID = @clientId;
    `);
  if (locked.recordset.length !== 1) {
    throw new ReferralCheckoutError('REFERRAL_NOT_ELIGIBLE', 'العميل غير تابع للمنشأة', 404);
  }
  if (input.referralVoucherId != null) {
    if (input.referralCode != null || !referralRewardRedemptionEnabled()) {
      throw new ReferralCheckoutError('REFERRAL_DISCOUNT_CONFLICT', 'صرف المكافأة غير متاح مع خصم إحالة آخر', 409);
    }
    if (!Number.isSafeInteger(input.referralVoucherId) || input.referralVoucherId < 1) {
      throw new ReferralCheckoutError('INVALID_REFERRAL_VOUCHER', 'مكافأة إحالة غير صالحة', 400);
    }
    // Same transaction as eventual invoice payment. This lock protects against
    // concurrent cashiers or repeated voucher redemption requests.
    const voucher = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('clientId', sql.Int, clientId)
      .input('voucherId', sql.BigInt, input.referralVoucherId)
      .query(`
        SELECT v.VoucherID
        FROM dbo.TblReferralDiscountVoucher v WITH (UPDLOCK, HOLDLOCK)
        INNER JOIN dbo.TblReferralVisitClaim c
          ON c.TenantId = v.TenantId AND c.ClaimID = v.ClaimID
          AND c.ReferrerClientID = v.ReferrerClientID
        WHERE v.TenantId = @tenantId AND v.ReferrerClientID = @clientId
          AND v.VoucherID = @voucherId AND v.DiscountPercent = 20
          AND v.Status = N'ACTIVE' AND v.UsedInvID IS NULL
          AND (v.ExpiresAtUtc IS NULL OR v.ExpiresAtUtc > SYSUTCDATETIME())
          AND c.Status IN (N'APPLIED', N'REVERSED')
      `);
    if (voucher.recordset.length !== 1) {
      throw new ReferralCheckoutError('REFERRAL_VOUCHER_UNAVAILABLE',
        'مكافأة الإحالة مستخدمة أو غير صالحة أو انتهت', 409);
    }
    await assertReferralCheckoutCatalogPrices(tx, tenantId, input.items ?? []);
    return { tenantId, clientId, reservation: null,
      voucherReservation: { voucherId: input.referralVoucherId } };
  }

  if (!input.referralCode) {
    return { tenantId, clientId, reservation: null };
  }

  // Exact code shape must already have been validated by the API. Verify again
  // because this server helper can be used outside the route.
  if (!/^CUT-[0-9A-F]{24}$/.test(input.referralCode)) {
    throw new ReferralCheckoutError('INVALID_REFERRAL_CODE', 'كود إحالة غير صالح', 400);
  }
  const codeResult = await new sql.Request(tx)
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('code', sql.NVarChar(32), input.referralCode)
    .query(`
      SELECT ReferralCodeID, ReferrerClientID
      FROM dbo.TblReferralCustomerCode WITH (UPDLOCK, HOLDLOCK)
      WHERE TenantId = @tenantId AND Code = @code
        AND ActivatedAtUtc IS NOT NULL;
    `);
  const code = codeResult.recordset[0] as
    | { ReferralCodeID: number; ReferrerClientID: number }
    | undefined;
  if (!code || code.ReferrerClientID === clientId) {
    throw new ReferralCheckoutError('REFERRAL_NOT_ELIGIBLE', 'كود الإحالة غير مؤهل', 409);
  }

  // Price tampering must be refused inside the same transaction that saves
  // the invoice: no client price overrides or adjusted line bonuses.
  await assertReferralCheckoutCatalogPrices(tx, tenantId, input.items ?? []);

  // One query obtains all eligibility facts from the DB under the same
  // transaction; no browser-stated eligibility or client-provided referrer.
  const facts = await new sql.Request(tx)
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('referrerId', sql.Int, code.ReferrerClientID)
    .input('referredId', sql.Int, clientId)
    .query(`
      SELECT
        CASE WHEN EXISTS (
          SELECT 1 FROM dbo.TblinvServHead h
          INNER JOIN dbo.Location l
            ON l.LegacyBranchId = h.BranchID AND l.TenantId = @tenantId
          WHERE h.ClientID = @referrerId AND ${FULLY_PAID}
        ) THEN 1 ELSE 0 END AS ReferrerPaid,
        CASE WHEN EXISTS (
          SELECT 1 FROM dbo.TblinvServHead h
          INNER JOIN dbo.Location l
            ON l.LegacyBranchId = h.BranchID AND l.TenantId = @tenantId
          WHERE h.ClientID = @referredId AND ${FULLY_PAID}
        ) THEN 1 ELSE 0 END AS ReferredPaid,
        CASE WHEN EXISTS (
          SELECT 1 FROM dbo.TblReferralVisitClaim WITH (UPDLOCK, HOLDLOCK)
          WHERE TenantId = @tenantId AND ReferredClientID = @referredId
        ) THEN 1 ELSE 0 END AS Claimed;
    `);
  const row = facts.recordset[0] as
    | { ReferrerPaid: number; ReferredPaid: number; Claimed: number }
    | undefined;
  if (!row || row.ReferrerPaid !== 1 || row.ReferredPaid !== 0 || row.Claimed !== 0) {
    throw new ReferralCheckoutError('REFERRAL_NOT_ELIGIBLE', 'العميل أو الكود غير مؤهل لخصم الزيارة الأولى', 409);
  }

  // PENDING reservation is invisible to others until the enclosing invoice
  // transaction commits. Unique (TenantId, ReferredClientID) enforces
  // once-only under concurrent checkout, cancellation and retries.
  const claimed = await new sql.Request(tx)
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('codeId', sql.BigInt, code.ReferralCodeID)
    .input('referrerId', sql.Int, code.ReferrerClientID)
    .input('referredId', sql.Int, clientId)
    .query(`
      INSERT INTO dbo.TblReferralVisitClaim
        (TenantId, ReferralCodeID, ReferrerClientID, ReferredClientID, Status)
      OUTPUT INSERTED.ClaimID
      VALUES (@tenantId, @codeId, @referrerId, @referredId, N'PENDING');
    `);
  const claimId = Number(claimed.recordset[0]?.ClaimID);
  if (!Number.isSafeInteger(claimId) || claimId < 1) {
    throw new ReferralCheckoutError('REFERRAL_NOT_ELIGIBLE', 'تعذر حجز الإحالة', 409);
  }
  return {
    tenantId,
    clientId,
    reservation: {
      tenantId,
      referredClientId: clientId,
      referrerClientId: Number(code.ReferrerClientID),
      referralCodeId: Number(code.ReferralCodeID),
      claimId,
    },
  };
}

/**
 * Execute strictly AFTER BOTH invoice header and all payment rows exist but
 * BEFORE tx.commit(). Failure must roll back sale, its discount and its reward.
 */
export async function finalizeReferralSaleTransaction(
  tx: Transaction,
  prep: ReferralSalePreparation | null,
  invoice: { invID: number; invType: string; expectedGrandTotal: number },
): Promise<void> {
  if (!prep || prep.clientId === null) return;
  if (!Number.isInteger(invoice.invID) || invoice.invID < 1 || invoice.invType !== 'مبيعات') {
    throw new ReferralCheckoutError('REFERRAL_INVOICE_NOT_PAID', 'فاتورة الإحالة غير صالحة');
  }
  const paid = await new sql.Request(tx)
    .input('tenantId', sql.UniqueIdentifier, prep.tenantId)
    .input('clientId', sql.Int, prep.clientId)
    .input('invId', sql.Int, invoice.invID)
    .input('expected', sql.Decimal(10, 2), invoice.expectedGrandTotal)
    .query(`
      SELECT h.GrandTotal, h.Dis, h.DisVal
      FROM dbo.TblinvServHead h WITH (UPDLOCK, HOLDLOCK)
      INNER JOIN dbo.Location l
        ON l.LegacyBranchId = h.BranchID AND l.TenantId = @tenantId
      WHERE h.invID = @invId AND h.invType = N'مبيعات'
        AND h.ClientID = @clientId AND ${FULLY_PAID}
        AND h.GrandTotal = @expected
        AND (SELECT ISNULL(SUM(p.PayValue), 0)
             FROM dbo.TblinvServPayment p
             WHERE p.invID = h.invID AND p.invType = h.invType) = h.GrandTotal;
    `);
  const row = paid.recordset[0] as { GrandTotal: number; Dis: number; DisVal: number } | undefined;
  if (!row) {
    throw new ReferralCheckoutError('REFERRAL_INVOICE_NOT_PAID', 'لم يكتمل سداد فاتورة الإحالة');
  }

  if (prep.reservation) {
    // Defense in depth: a claimed referral MUST match persisted 50% discount.
    if (Math.abs(Number(row.Dis) - 50) > 0.01) {
      throw new ReferralCheckoutError('REFERRAL_INVOICE_NOT_PAID', 'خصم الإحالة لم يُحفظ على الفاتورة');
    }
    const updated = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, prep.tenantId)
      .input('claimId', sql.BigInt, prep.reservation.claimId)
      .input('invId', sql.Int, invoice.invID)
      .query(`
        UPDATE dbo.TblReferralVisitClaim
        SET Status = N'APPLIED',
            FirstPaidInvID = @invId, FirstPaidInvType = N'مبيعات',
            AppliedAtUtc = SYSUTCDATETIME()
        WHERE TenantId = @tenantId AND ClaimID = @claimId AND Status = N'PENDING';
      `);
    if (updated.rowsAffected?.[0] !== 1) {
      throw new ReferralCheckoutError('REFERRAL_NOT_ELIGIBLE', 'الإحالة سبق تسجيلها');
    }
    await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, prep.tenantId)
      .input('claimId', sql.BigInt, prep.reservation.claimId)
      .input('referrerId', sql.Int, prep.reservation.referrerClientId)
      .query(`
        INSERT INTO dbo.TblReferralDiscountVoucher
          (TenantId, ClaimID, ReferrerClientID, DiscountPercent, Status)
        VALUES (@tenantId, @claimId, @referrerId, 20, N'ACTIVE');
      `);
  }

  if (prep.voucherReservation) {
    if (Math.abs(Number(row.Dis) - 20) > 0.01) {
      throw new ReferralCheckoutError('REFERRAL_INVOICE_NOT_PAID', 'خصم المكافأة لم يُحفظ على الفاتورة');
    }
    // This happens AFTER the persisted invoice & payment checks and BEFORE
    // COMMIT. If another cashier already spent it or this SQL write fails,
    // the enclosing invoice and all payment/treasury effects roll back.
    const redeemed = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, prep.tenantId)
      .input('clientId', sql.Int, prep.clientId)
      .input('voucherId', sql.BigInt, prep.voucherReservation.voucherId)
      .input('invId', sql.Int, invoice.invID)
      .query(`
        UPDATE dbo.TblReferralDiscountVoucher
        SET Status = N'USED', UsedAtUtc = SYSUTCDATETIME(),
            UsedInvID = @invId, UsedInvType = N'مبيعات'
        WHERE TenantId = @tenantId AND ReferrerClientID = @clientId
          AND VoucherID = @voucherId AND Status = N'ACTIVE'
          AND UsedInvID IS NULL
          AND (ExpiresAtUtc IS NULL OR ExpiresAtUtc > SYSUTCDATETIME())
          AND EXISTS (
            SELECT 1 FROM dbo.TblReferralVisitClaim c
            WHERE c.TenantId = @tenantId
              AND c.ClaimID = dbo.TblReferralDiscountVoucher.ClaimID
              AND c.ReferrerClientID = @clientId AND c.Status IN (N'APPLIED', N'REVERSED')
          );
      `);
    if (redeemed.rowsAffected?.[0] !== 1) {
      throw new ReferralCheckoutError('REFERRAL_VOUCHER_UNAVAILABLE',
        'المكافأة لم تعد متاحة؛ الفاتورة لن تُحفظ', 409);
    }
  }

  // Activate/generate a permanent code for EVERY first paid customer,
  // inside the very same invoice transaction. The owner row was UPDLOCKed.
  const previous = await new sql.Request(tx)
    .input('tenantId', sql.UniqueIdentifier, prep.tenantId)
    .input('clientId', sql.Int, prep.clientId)
    .query(`
      SELECT ReferralCodeID, ActivatedAtUtc FROM dbo.TblReferralCustomerCode WITH (UPDLOCK, HOLDLOCK)
      WHERE TenantId = @tenantId AND ReferrerClientID = @clientId;
    `);
  if (!previous.recordset.length) {
    const permanentCode = generatePermanentReferralCheckoutCode(randomBytes);
    await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, prep.tenantId)
      .input('clientId', sql.Int, prep.clientId)
      .input('code', sql.NVarChar(32), permanentCode)
      .query(`
        INSERT INTO dbo.TblReferralCustomerCode
          (TenantId, ReferrerClientID, Code, ActivatedAtUtc)
        VALUES (@tenantId, @clientId, @code, SYSUTCDATETIME());
      `);
  } else if (previous.recordset[0]?.ActivatedAtUtc == null) {
    await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, prep.tenantId)
      .input('clientId', sql.Int, prep.clientId)
      .query(`
        UPDATE dbo.TblReferralCustomerCode
        SET ActivatedAtUtc = SYSUTCDATETIME()
        WHERE TenantId = @tenantId AND ReferrerClientID = @clientId
          AND ActivatedAtUtc IS NULL;
      `);
  }
}
