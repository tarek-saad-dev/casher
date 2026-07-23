import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import {
  EmployeeLedgerFundingError,
  executeEmployeeFunding,
} from '@/lib/services/employeeLedgerFundingService';
import { requireBranchOperationAccess } from '@/lib/branch/context';
import { resolveBranchDayForDate } from '@/lib/branch/operationalGates';

/**
 * POST /api/admin/hr/employee-ledger/employee-funding
 * Record employee-to-business funding — cash-in + ledger credit liability.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;

  try {
    const body = await request.json();
    const empId = Number(body.empId);
    const amount = Number(body.amount);
    const paymentMethodId = Number(body.paymentMethodId);
    const date = String(body.date ?? '').trim();
    const notes = body.notes != null ? String(body.notes) : undefined;

    // Never trust browser branchId — resolve ownership from gated session context.
    const branch = await requireBranchOperationAccess();
    if (branch instanceof NextResponse) return branch;
    const dayResolution = await resolveBranchDayForDate(branch.branchId, date);
    if (!dayResolution.ok) return dayResolution.response;

    const result = await executeEmployeeFunding({
      empId,
      amount,
      paymentMethodId,
      date,
      notes,
      createdByUserId: auth.userId,
      branchId: branch.branchId,
      businessDayId: dayResolution.day.id,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof EmployeeLedgerFundingError) {
      const status = error.message.includes('EMP_LEDGER_DUAL_WRITE_ENABLED') ? 503 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[api/admin/hr/employee-ledger/employee-funding] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
