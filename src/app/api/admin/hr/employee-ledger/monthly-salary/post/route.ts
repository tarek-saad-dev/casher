import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { requireBranchOperationAccess } from '@/lib/branch/context';
import {
  EmployeeLedgerMonthlySalaryError,
  postMonthlySalaryEntitlements,
} from '@/lib/services/employeeLedgerMonthlySalaryService';

/**
 * POST /api/admin/hr/employee-ledger/monthly-salary/post
 * Post monthly salary entitlements to Employee Ledger (no cash movement).
 * BranchID from session only (Phase 1L).
 */
export async function POST(request: NextRequest) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;

  try {
    const body = await request.json();
    if (body.branchId != null || body.BranchID != null) {
      return NextResponse.json({ error: 'BranchID في الطلب غير مسموح' }, { status: 400 });
    }

    const month = String(body.month ?? '').trim();
    const postingDate = body.postingDate != null ? String(body.postingDate).trim() : undefined;
    const empIdRaw = body.empId;
    const empId = empIdRaw != null && empIdRaw !== '' ? Number(empIdRaw) : undefined;
    const dryRun = body.dryRun !== false;

    if (!month) {
      return NextResponse.json({ error: 'month مطلوب بصيغة YYYY-MM' }, { status: 400 });
    }

    const branch = await requireBranchOperationAccess();
    if (branch instanceof NextResponse) return branch;

    const result = await postMonthlySalaryEntitlements({
      month,
      branchId: branch.branchId,
      postingDate,
      empId,
      dryRun,
      createdByUserId: auth.userId,
    });

    return NextResponse.json({ ...result, branchId: branch.branchId });
  } catch (error: unknown) {
    if (error instanceof EmployeeLedgerMonthlySalaryError) {
      const status = error.message.includes('EMP_LEDGER_DUAL_WRITE_ENABLED') ? 503 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[api/admin/hr/employee-ledger/monthly-salary/post] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
