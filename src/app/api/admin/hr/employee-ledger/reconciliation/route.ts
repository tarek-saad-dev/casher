import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { getEmployeeLedgerReconciliation } from '@/lib/services/employeeLedgerReconciliationService';
import { validateLedgerMonth } from '@/lib/services/employeeLedgerService';

function isMissingLedgerTableError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('tblempledgerentry') && (
    lower.includes('invalid object name') ||
    lower.includes('does not exist')
  );
}

/**
 * GET /api/admin/hr/employee-ledger/reconciliation?month=YYYY-MM&empId=
 * Read-only reconciliation between payroll, ledger, cash moves, and legacy mirrors.
 */
export async function GET(request: NextRequest) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');
    const empIdParam = searchParams.get('empId');
    const empId = empIdParam ? parseInt(empIdParam, 10) : null;

    if (!month) {
      return NextResponse.json({ error: 'month مطلوب بصيغة YYYY-MM' }, { status: 400 });
    }

    const monthError = validateLedgerMonth(month);
    if (monthError) {
      return NextResponse.json({ error: monthError }, { status: 400 });
    }

    if (empIdParam && (Number.isNaN(empId) || empId! <= 0)) {
      return NextResponse.json({ error: 'empId غير صالح' }, { status: 400 });
    }

    const result = await getEmployeeLedgerReconciliation(month, empId);
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (isMissingLedgerTableError(message)) {
      return NextResponse.json(
        {
          error: 'جدول دفتر الموظفين غير موجود — شغّل db/migrations/create-tbl-emp-ledger-entry.sql',
          summary: null,
          missingPayrollCredits: [],
          orphanLedgerCredits: [],
          missingAdvanceDebits: [],
          unresolvedCashAdvances: [],
          advanceAmountMismatches: [],
          advanceDiagnosticRows: [],
          missingPayoutDebits: [],
          legacyMirrorRows: [],
        },
        { status: 503 },
      );
    }
    console.error('[api/admin/hr/employee-ledger/reconciliation] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
