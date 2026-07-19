import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { isEmployeeLedgerDualWriteEnabled } from '@/lib/employeeLedgerConfig';
import { getLegacyPostToCashConfig } from '@/lib/payroll/legacyPostToCashFlags';
import {
  getEmployeeLedgerSummary,
  validateLedgerMonth,
} from '@/lib/services/employeeLedgerService';
function isMissingLedgerTableError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('tblempledgerentry') && (
    lower.includes('invalid object name') ||
    lower.includes('does not exist')
  );
}

/**
 * GET /api/admin/hr/employee-ledger/summary?month=YYYY-MM
 * Per-employee ledger summary for a payroll month.
 */
export async function GET(request: NextRequest) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');

    if (!month) {
      return NextResponse.json({ error: 'month مطلوب بصيغة YYYY-MM' }, { status: 400 });
    }

    const monthError = validateLedgerMonth(month);
    if (monthError) {
      return NextResponse.json({ error: monthError }, { status: 400 });
    }

    const result = await getEmployeeLedgerSummary(month);
    const legacyConfig = getLegacyPostToCashConfig();
    return NextResponse.json({
      ...result,
      ledgerDualWriteEnabled: isEmployeeLedgerDualWriteEnabled(),
      legacyPostToCashDisabled: legacyConfig.legacyPostToCashDisabled,
      legacyPostToCashWarning: legacyConfig.legacyPostToCashWarning,
      redirectTab: legacyConfig.redirectTab,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (isMissingLedgerTableError(message)) {
      return NextResponse.json(
        {
          error: 'جدول دفتر الموظفين غير موجود — شغّل db/migrations/create-tbl-emp-ledger-entry.sql',
          month: request.nextUrl.searchParams.get('month') ?? '',
          employees: [],
          totals: {
            salaryCredits: 0,
            targetCredits: 0,
            fundingCredits: 0,
            advanceDebits: 0,
            payoutDebits: 0,
            deductionDebits: 0,
            balance: 0,
            revenue: 0,
            payoutWithinDues: 0,
            revenueWithdrawal: 0,
            advanceExcess: 0,
          },
        },
        { status: 503 },
      );
    }
    console.error('[api/admin/hr/employee-ledger/summary] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
