import { NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { getSession } from '@/lib/session';
import { getPool, sql } from '@/lib/db';
import { ensureBookingCashierHandoffTable } from '@/lib/booking/cashierHandoff';
import { resolveBranchDayAndShiftForWrite, branchErrorResponse } from '@/lib/branch/operationalGates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Read-only recovery inbox: finds paid invoices with a durable handoff marker,
 * but without a completed handoff link. Never creates or changes an invoice.
 */
export async function GET() {
  const auth = await requirePageAccess('/income/pos');
  if (!isAuthResult(auth)) return auth;
  const session = await getSession();
  if (!session?.UserID || !session.TenantId) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  }
  try {
    const gated = await resolveBranchDayAndShiftForWrite(session.UserID);
    if (!gated.ok) return NextResponse.json({ items: [], count: 0 });
    await ensureBookingCashierHandoffTable();
    const pool = await getPool();
    const found = await pool.request()
      .input('branch', sql.Int, gated.branch.branchId)
      .input('tenant', sql.NVarChar(100), String(session.TenantId))
      .query(
        "SELECT TOP (20) h.HandoffID, inv.invID, inv.invDate " +
        "FROM dbo.TblBookingCashierHandoff h " +
        "INNER JOIN dbo.Bookings b ON b.BookingID=h.BookingID AND b.BranchID=@branch " +
        "INNER JOIN dbo.TblEmp e ON e.EmpID=b.AssignedEmpID AND e.TenantId=@tenant " +
        "INNER JOIN dbo.TblinvServHead inv ON inv.BranchID=h.BranchID AND inv.invType=N'مبيعات' " +
        "INNER JOIN dbo.Location l ON l.LegacyBranchId=inv.BranchID " +
        "AND l.TenantId=TRY_CONVERT(UNIQUEIDENTIFIER,@tenant) " +
        "OUTER APPLY (SELECT SUM(PayValue) AS Paid FROM dbo.TblinvServPayment " +
        "WHERE invID=inv.invID AND invType=inv.invType) payment " +
        "WHERE h.TenantId=@tenant AND h.BranchID=@branch " +
        "AND h.Status IN (N'pending',N'loaded') AND h.ChargedInvID IS NULL " +
        "AND RIGHT(ISNULL(CONVERT(NVARCHAR(MAX),inv.Notes2),N''), " +
        "LEN(N'CUT_HANDOFF:'+CONVERT(NVARCHAR(20),h.HandoffID)+N'|')) " +
        "=N'CUT_HANDOFF:'+CONVERT(NVARCHAR(20),h.HandoffID)+N'|' " +
        "AND ISNULL(inv.PayDue,0)<=0.01 AND ISNULL(payment.Paid,0)+0.01>=inv.GrandTotal " +
        "ORDER BY inv.invDate DESC, inv.invID DESC"
      );
    const items = (found.recordset as Array<{ HandoffID:number;invID:number;invDate:Date }>).map(x => ({
      handoffId: x.HandoffID, invId: x.invID, invDate: x.invDate,
    }));
    return NextResponse.json({ items, count: items.length }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const mapped = branchErrorResponse(error);
    if (mapped) return mapped;
    console.error('[pos/handoff-recovery-inbox]', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'تعذر فحص الفواتير التي تحتاج ربطًا' }, { status: 503 });
  }
}
