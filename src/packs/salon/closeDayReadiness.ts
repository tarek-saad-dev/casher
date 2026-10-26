/**
 * Closing a new DRVO salon day is a financial/operational boundary.
 * Existing CUT compatibility stays unchanged until the dedicated migration.
 */
import type sql from 'mssql';
import { BranchDomainError } from '@/lib/branch/types';

export const PENDING_SALON_QUEUE_STATUSES = ['waiting', 'called', 'arrived', 'in_service'] as const;

export function isIndependentSalonBranch(branchCode: string): boolean {
  return /^DRVO_[0-9A-F]{10}_MAIN$/i.test(branchCode.trim());
}

export async function assertNoPendingSalonQueueAtClose(
  tx: sql.Transaction,
  args: { branchId: number; businessDate: string; branchCode: string },
): Promise<void> {
  // Keep existing Cut Salon close behavior intact. Fresh public-signup salons
  // use the standardized DRVO branch code. No system-wide security rewrite.
  if (!isIndependentSalonBranch(args.branchCode)) return;
  const { default: mssql } = await import('mssql');
  const pending = await new mssql.Request(tx)
    .input('branchId', mssql.Int, args.branchId)
    .input('workDate', mssql.Date, args.businessDate)
    .query(`
      SELECT COUNT_BIG(*) AS PendingCount
      FROM dbo.QueueTickets WITH (UPDLOCK, HOLDLOCK)
      WHERE BranchID = @branchId
        AND QueueDate = @workDate
        AND Status IN ('waiting', 'called', 'arrived', 'in_service')
    `);
  const count = Number(pending.recordset[0]?.PendingCount ?? 0);
  if (count > 0) {
    throw new BranchDomainError(
      'PENDING_QUEUE_TICKETS',
      `لا يمكن قفل اليوم: يوجد ${count} عميل لم تكتمل خدمته في هذا الفرع`,
      409,
    );
  }
}
