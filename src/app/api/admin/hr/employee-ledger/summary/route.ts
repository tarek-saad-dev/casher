import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { requireBranchOperationAccess, isActiveBranchContext } from '@/lib/branch/context';
import { listUserValidBranchAccess, listActiveBranches } from '@/lib/branch/repository';
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

async function resolveAccessibleBranchIds(userId: number): Promise<number[]> {
  const [access, active] = await Promise.all([
    listUserValidBranchAccess(userId),
    listActiveBranches(),
  ]);
  const activeIds = new Set(active.map((b) => b.branchId));
  const ids = access
    .filter(
      (a) =>
        activeIds.has(a.branchId) &&
        (a.canOperate || a.canSwitch || a.canViewReports || a.isDefault),
    )
    .map((a) => a.branchId);
  // Always include session-operable set; prefer stable order by id
  return [...new Set(ids)].sort((a, b) => a - b);
}

/**
 * GET /api/admin/hr/employee-ledger/summary?month=YYYY-MM&branchId=all|<id>
 * Per-employee ledger summary + branch financial strip (entry BranchID).
 */
export async function GET(request: NextRequest) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;

  try {
    const branch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(branch)) return branch;

    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');
    const branchParam = (searchParams.get('branchId') || 'all').trim().toLowerCase();

    if (!month) {
      return NextResponse.json({ error: 'month مطلوب بصيغة YYYY-MM' }, { status: 400 });
    }

    const monthError = validateLedgerMonth(month);
    if (monthError) {
      return NextResponse.json({ error: monthError }, { status: 400 });
    }

    const accessible = await resolveAccessibleBranchIds(branch.userId);
    // Ensure session branch is always visible
    if (!accessible.includes(branch.branchId)) {
      accessible.push(branch.branchId);
    }

    let filterBranchId: number | null = null;
    if (branchParam !== 'all' && branchParam !== '') {
      const bid = Number(branchParam);
      if (!Number.isFinite(bid) || bid <= 0) {
        return NextResponse.json({ error: 'معرف الفرع غير صالح' }, { status: 400 });
      }
      if (!accessible.includes(bid)) {
        return NextResponse.json({ error: 'غير مصرح بالوصول لهذا الفرع' }, { status: 403 });
      }
      filterBranchId = bid;
    }

    const result = await getEmployeeLedgerSummary(month, filterBranchId, {
      accessibleBranchIds: accessible,
    });
    const legacyConfig = getLegacyPostToCashConfig();
    return NextResponse.json({
      ...result,
      accessibleBranches: (await listActiveBranches())
        .filter((b) => accessible.includes(b.branchId))
        .map((b) => ({
          branchId: b.branchId,
          branchCode: b.branchCode,
          branchName: b.branchName,
        })),
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
