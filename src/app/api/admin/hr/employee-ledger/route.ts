import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { getEmployeeLedgerEntries } from '@/lib/services/employeeLedgerService';

function isMissingLedgerTableError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('tblempledgerentry') && (
    lower.includes('invalid object name') ||
    lower.includes('does not exist')
  );
}

/**
 * GET /api/admin/hr/employee-ledger
 * Read-only employee ledger entries.
 *
 * Query params:
 *   empId     optional employee filter
 *   dateFrom  YYYY-MM-DD (ignored when month is set)
 *   dateTo    YYYY-MM-DD (ignored when month is set)
 *   month     YYYY-MM payroll month filter
 */
export async function GET(request: NextRequest) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const empIdParam = searchParams.get('empId');
    const empId = empIdParam ? parseInt(empIdParam, 10) : null;

    if (empIdParam && (Number.isNaN(empId) || empId! <= 0)) {
      return NextResponse.json({ error: 'empId غير صالح' }, { status: 400 });
    }

    const result = await getEmployeeLedgerEntries({
      empId,
      dateFrom: searchParams.get('dateFrom'),
      dateTo: searchParams.get('dateTo'),
      month: searchParams.get('month'),
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (isMissingLedgerTableError(message)) {
      return NextResponse.json(
        {
          error: 'جدول دفتر الموظفين غير موجود — شغّل db/migrations/create-tbl-emp-ledger-entry.sql',
          entries: [],
          totalCredits: 0,
          totalDebits: 0,
          balance: 0,
          filters: {
            empId: null,
            dateFrom: null,
            dateTo: null,
            month: null,
          },
        },
        { status: 503 },
      );
    }
    console.error('[api/admin/hr/employee-ledger] GET error:', message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
