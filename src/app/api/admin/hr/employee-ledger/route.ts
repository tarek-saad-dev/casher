import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { requireBranchOperationAccess, isActiveBranchContext } from '@/lib/branch/context';
import { listUserValidBranchAccess, listActiveBranches } from '@/lib/branch/repository';
import {
  getEmployeeLedgerEntries,
  getEmployeeLedgerTableBranches,
  mergeEmployeeLedgerBranchScope,
} from '@/lib/services/employeeLedgerService';

function isMissingLedgerTableError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('tblempledgerentry') && (
    lower.includes('invalid object name') ||
    lower.includes('does not exist')
  );
}

async function resolveAccessibleBranchIds(userId: number, sessionBranchId: number): Promise<number[]> {
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
  if (!ids.includes(sessionBranchId)) ids.push(sessionBranchId);
  return [...new Set(ids)].sort((a, b) => a - b);
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
 *   branchId  all | <id>  (default all accessible)
 */
export async function GET(request: NextRequest) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;

  try {
    const branch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(branch)) return branch;

    const { searchParams } = new URL(request.url);
    const empIdParam = searchParams.get('empId');
    const empId = empIdParam ? parseInt(empIdParam, 10) : null;
    const branchParam = (searchParams.get('branchId') || 'all').trim().toLowerCase();

    if (empIdParam && (Number.isNaN(empId) || empId! <= 0)) {
      return NextResponse.json({ error: 'empId غير صالح' }, { status: 400 });
    }

    const accessible = await resolveAccessibleBranchIds(branch.userId, branch.branchId);

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

    const tableBranches = await getEmployeeLedgerTableBranches();
    const ledgerBranchScope = mergeEmployeeLedgerBranchScope(
      accessible,
      tableBranches.map((b) => b.branchId),
    );

    const result = await getEmployeeLedgerEntries({
      empId,
      dateFrom: searchParams.get('dateFrom'),
      dateTo: searchParams.get('dateTo'),
      month: searchParams.get('month'),
      branchId: filterBranchId,
      branchIds: filterBranchId == null ? ledgerBranchScope : null,
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
            branchId: null,
          },
        },
        { status: 503 },
      );
    }
    console.error('[api/admin/hr/employee-ledger] GET error:', message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
