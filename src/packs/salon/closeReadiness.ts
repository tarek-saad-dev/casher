import 'server-only';
import { getPool, sql } from '@/lib/db';
import { getOpenBusinessDay } from '@/lib/branch/businessDay';
import type { ActiveBranchContext } from '@/lib/branch/types';

export type CloseReadinessItem = {
  code: 'NO_OPEN_DAY' | 'PENDING_QUEUE' | 'OPEN_SHIFTS' | 'TREASURY_UNRECONCILED';
  message: string;
  count?: number;
  blocking: boolean;
  link: string;
};
export type SalonCloseReadiness = {
  branchId: number;
  businessDayId: number | null;
  workDate: string | null;
  canCloseOperations: boolean;
  treasuryReconciliationRecorded: boolean;
  operationalBlockersClear: boolean;
  items: CloseReadinessItem[];
  metrics: {
    pendingClients: number;
    openShifts: number;
    treasuryReconciliations: number;
  };
};

/**
 * Read-only guidance for managers. A successful preview does not perform or
 * authorize closing a day; close mutation must recheck its own invariants.
 *
 * Financial reconciliation is informative until a dedicated approved policy
 * makes it a mutation blocker. Never silently count it as complete when absent.
 */
export async function getSalonCloseReadiness(
  branch: ActiveBranchContext,
): Promise<SalonCloseReadiness> {
  const day = await getOpenBusinessDay(branch.branchId);
  if (!day) {
    const item: CloseReadinessItem = {
      code: 'NO_OPEN_DAY', message: 'لا يوجد يوم عمل مفتوح لقفله',
      blocking: true, link: '/admin', 
    };
    return {
      branchId: branch.branchId, businessDayId: null, workDate: null,
      canCloseOperations: false, treasuryReconciliationRecorded: false,
      operationalBlockersClear: false, items: [item],
      metrics: { pendingClients: 0, openShifts: 0, treasuryReconciliations: 0 },
    };
  }

  const db = await getPool();
  const req = () => db.request()
    .input('branchId', sql.Int, branch.branchId)
    .input('dayId', sql.Int, day.id)
    .input('workDate', sql.Date, day.newDay);
  const [queue, shifts, treasury] = await Promise.all([
    req().query(`
      SELECT COUNT_BIG(*) AS Total
      FROM dbo.QueueTickets
      WHERE BranchID = @branchId AND QueueDate = @workDate
        AND Status IN ('waiting', 'called', 'arrived', 'in_service')
    `),
    req().query(`
      SELECT COUNT_BIG(*) AS Total
      FROM dbo.TblShiftMove
      WHERE BranchID = @branchId AND BusinessDayID = @dayId AND Status = 1
    `),
    req().query(`
      SELECT COUNT_BIG(*) AS Total
      FROM dbo.TblTreasuryCloseRecon
      WHERE BranchID = @branchId AND NewDay = @dayId AND IsActive = 1
    `),
  ]);
  const pendingClients = Number(queue.recordset[0]?.Total ?? 0);
  const openShifts = Number(shifts.recordset[0]?.Total ?? 0);
  const treasuryReconciliations = Number(treasury.recordset[0]?.Total ?? 0);
  const items: CloseReadinessItem[] = [];
  if (pendingClients > 0) items.push({
    code: 'PENDING_QUEUE', message: `يوجد ${pendingClients} عميل لم تكتمل خدمته`,
    count: pendingClients, blocking: true, link: '/admin/queue',
  });
  if (openShifts > 0) items.push({
    code: 'OPEN_SHIFTS', message: `يوجد ${openShifts} وردية لم تُقفل`,
    count: openShifts, blocking: true, link: '/admin',
  });
  if (treasuryReconciliations === 0) items.push({
    code: 'TREASURY_UNRECONCILED', message: 'لم يتم تسجيل مطابقة الخزينة لهذا اليوم',
    count: 0, blocking: false, link: '/admin/treasury',
  });

  const canCloseOperations = !items.some((item) => item.blocking);
  const treasuryReconciliationRecorded = treasuryReconciliations > 0;
  return {
    branchId: branch.branchId, businessDayId: day.id, workDate: day.newDay,
    canCloseOperations, treasuryReconciliationRecorded,
    operationalBlockersClear: canCloseOperations,
    items, metrics: { pendingClients, openShifts, treasuryReconciliations },
  };
}
