import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { EmployeeLedgerDualWriteError } from '@/lib/services/employeeLedgerDualWrite';
import { runEmployeeLedgerHistoricalSync } from '@/lib/services/employeeLedgerSyncService';

/**
 * POST /api/admin/hr/employee-ledger/sync
 * Historical backfill/sync for payroll credits and advance debits into employee ledger.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;

  try {
    const body = await request.json();
    const month = String(body.month ?? '').trim();
    const empId = body.empId != null ? Number(body.empId) : null;
    const dryRun = body.dryRun !== false;
    const syncPayrollCredits = body.syncPayrollCredits !== false;
    const syncAdvanceDebits = body.syncAdvanceDebits !== false;

    if (!month) {
      return NextResponse.json({ error: 'month مطلوب بصيغة YYYY-MM' }, { status: 400 });
    }

    if (empId != null && (Number.isNaN(empId) || empId <= 0)) {
      return NextResponse.json({ error: 'empId غير صالح' }, { status: 400 });
    }

    const result = await runEmployeeLedgerHistoricalSync({
      month,
      empId,
      dryRun,
      syncPayrollCredits,
      syncAdvanceDebits,
      createdByUserId: auth.userId,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof EmployeeLedgerDualWriteError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
