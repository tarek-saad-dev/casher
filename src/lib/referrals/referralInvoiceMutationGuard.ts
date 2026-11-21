import 'server-only';
import type { Transaction } from 'mssql';
import { sql } from '@/lib/db';
import { ReferralCheckoutError } from './referralCheckoutPolicy';

/**
 * Prevent editing/deleting a paid invoice already linked to a referral reward.
 * A full audited reversal workflow must be implemented before relaxing this.
 * Fail-open ONLY when the table doesn't exist yet (DRVO-023 not migrated);
 * ordinary historical invoices do not depend on referral migrations.
 *
 * Must be called inside the existing invoice edit/delete SQL transaction,
 * not in a preflight request followed by unrelated write.
 */
export async function assertReferralInvoiceNotMutated(
  transaction: Transaction,
  tenantId: string,
  invoiceId: number,
): Promise<void> {
  const exists = await new sql.Request(transaction).query(`
    SELECT CASE WHEN OBJECT_ID(N'dbo.TblReferralVisitClaim', N'U') IS NOT NULL
      THEN 1 ELSE 0 END AS Ready;
  `);
  if (Number(exists.recordset[0]?.Ready) !== 1) return;

  const linked = await new sql.Request(transaction)
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('invId', sql.Int, invoiceId)
    .query(`
      SELECT TOP (1) ClaimID
      FROM dbo.TblReferralVisitClaim WITH (UPDLOCK, HOLDLOCK)
      WHERE TenantId = @tenantId AND FirstPaidInvID = @invId
        AND FirstPaidInvType = N'مبيعات';
    `);
  if (linked.recordset.length > 0) {
    throw new ReferralCheckoutError(
      'REFERRAL_NOT_ELIGIBLE',
      'لا يمكن تعديل أو حذف فاتورة مرتبطة بمكافأة إحالة قبل تنفيذ مسار مراجعة واسترجاع المكافأة',
      409,
    );
  }
}
