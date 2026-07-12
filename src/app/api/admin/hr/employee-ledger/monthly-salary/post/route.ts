import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import {
  EmployeeLedgerMonthlySalaryError,
  postMonthlySalaryEntitlements,
} from '@/lib/services/employeeLedgerMonthlySalaryService';

/**
 * POST /api/admin/hr/employee-ledger/monthly-salary/post
 * Post monthly salary entitlements to Employee Ledger (no cash movement).
 */
export async function POST(request: NextRequest) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;

  try {
    const body = await request.json();
    const month = String(body.month ?? '').trim();
    const postingDate = body.postingDate != null ? String(body.postingDate).trim() : undefined;
    const empIdRaw = body.empId;
    const empId = empIdRaw != null && empIdRaw !== '' ? Number(empIdRaw) : undefined;
    const dryRun = body.dryRun !== false;

    if (!month) {
      return NextResponse.json({ error: 'month مطلوب بصيغة YYYY-MM' }, { status: 400 });
    }

    const result = await postMonthlySalaryEntitlements({
      month,
      postingDate,
      empId: empId != null && !Number.isNaN(empId) ? empId : undefined,
      dryRun,
      createdByUserId: auth.userId,
    });

    return NextResponse.json(result, { status: dryRun ? 200 : 201 });
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
