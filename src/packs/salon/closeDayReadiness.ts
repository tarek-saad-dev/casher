/**
 * Closing a new DRVO salon day is a financial/operational boundary.
 * Existing CUT compatibility stays unchanged until the dedicated migration.
 */
import sql from 'mssql';
import { BranchDomainError } from '@/lib/branch/types';

export const PENDING_SALON_QUEUE_STATUSES = ['waiting', 'called', 'arrived', 'in_service'] as const;

export function isIndependentSalonBranch(branchCode: string): boolean {
  return /^DRVO_[0-9A-F]{10}_MAIN$/i.test(branchCode.trim());
}

export async function assertNoPendingSalonQueueAtClose(
  tx: sql.Transaction,
  args: { branchId: number; businessDate: string; branchCode: string },
): Promise<void> {
  // Preserve existing CUT behavior, and avoid affecting non-salon DRVO tenants.
  // Standard signup code narrows the scope; TenantIndustryPack proves industry.
  if (!isIndependentSalonBranch(args.branchCode)) return;
  const pending = await new sql.Request(tx)
    .input('branchId', sql.Int, args.branchId)
    .input('workDate', sql.Date, args.businessDate)
    .query(`
      SELECT COUNT_BIG(*) AS PendingCount
      FROM dbo.QueueTickets WITH (UPDLOCK, HOLDLOCK)
      WHERE BranchID = @branchId
        AND QueueDate = @workDate
        AND Status IN ('waiting', 'called', 'arrived', 'in_service')
        AND EXISTS (
          SELECT 1 FROM dbo.Location l
          INNER JOIN dbo.TenantIndustryPack p ON p.TenantId = l.TenantId
          WHERE l.LegacyBranchId = @branchId AND p.PackCode = N'salon'
        )
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
