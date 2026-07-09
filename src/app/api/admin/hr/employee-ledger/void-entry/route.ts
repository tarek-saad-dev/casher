import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import {
  EmployeeLedgerCleanupError,
  voidReconciliationLedgerEntry,
} from '@/lib/services/employeeLedgerReconciliationCleanupService';

/**
 * POST /api/admin/hr/employee-ledger/void-entry
 * Safely voids orphan advance ledger entries from reconciliation cleanup.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;

  try {
    const body = await request.json();
    const ledgerEntryId = Number(body.ledgerEntryId);
    const reason = String(body.reason ?? '').trim();

    if (!ledgerEntryId || Number.isNaN(ledgerEntryId) || ledgerEntryId <= 0) {
      return NextResponse.json({ error: 'ledgerEntryId غير صالح' }, { status: 400 });
    }
    if (!reason) {
      return NextResponse.json({ error: 'سبب الإلغاء مطلوب' }, { status: 400 });
    }

    const result = await voidReconciliationLedgerEntry(ledgerEntryId, reason);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof EmployeeLedgerCleanupError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error('[void-entry] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
