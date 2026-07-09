import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import {
  EmployeeLedgerCleanupError,
  upsertAdvanceCategoryMapping,
} from '@/lib/services/employeeLedgerReconciliationCleanupService';

/**
 * POST /api/admin/hr/employee-ledger/reconciliation/fix-advance-mapping
 * Upserts TblExpCatEmpMap for advance category cleanup — does not modify CashMove or ledger.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;

  try {
    const body = await request.json();
    const expInId = Number(body.expInId);
    const empId = Number(body.empId);
    const txnKind = String(body.txnKind ?? '').trim();

    if (!expInId || Number.isNaN(expInId) || expInId <= 0) {
      return NextResponse.json({ error: 'expInId غير صالح' }, { status: 400 });
    }
    if (!empId || Number.isNaN(empId) || empId <= 0) {
      return NextResponse.json({ error: 'empId غير صالح' }, { status: 400 });
    }
    if (txnKind !== 'advance') {
      return NextResponse.json({ error: 'txnKind يجب أن يكون advance' }, { status: 400 });
    }

    const result = await upsertAdvanceCategoryMapping(expInId, empId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof EmployeeLedgerCleanupError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error('[fix-advance-mapping] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
