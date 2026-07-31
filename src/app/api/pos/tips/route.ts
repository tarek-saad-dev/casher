import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { scheduleEmployeeTipWhatsApp } from '@/lib/services/employeeAdvanceWhatsAppNotify';
import {
  EmployeeTipError,
  executeEmployeeTip,
} from '@/lib/services/employeeTipService';
import { requireBranchOperationAccess } from '@/lib/branch/context';
import { resolveActiveBranchDayForPosWrite } from '@/lib/branch/operationalGates';

/**
 * POST /api/pos/tips
 * Record tip from overpayment: cash-in (تبس) + employee ledger credit.
 *
 * Body: { empId, invoiceTotal, amountPaid, paymentMethodId }
 *
 * Date/branch ownership always come from the active-branch open day (or the
 * cutoff-aware business date). Browser calendar dates are ignored so midnight
 * before 04:00 still attaches to the same operational day.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePageAccess('/income/pos');
  if (!isAuthResult(auth)) return auth;

  try {
    const body = await request.json();
    const empId = Number(body.empId);
    const invoiceTotal = Number(body.invoiceTotal);
    const amountPaid = Number(body.amountPaid);
    const paymentMethodId = Number(body.paymentMethodId);

    // Never trust browser branchId/date — resolve ownership from gated session context.
    const branch = await requireBranchOperationAccess();
    if (branch instanceof NextResponse) return branch;
    const dayResolution = await resolveActiveBranchDayForPosWrite(branch);
    if (!dayResolution.ok) return dayResolution.response;

    const result = await executeEmployeeTip({
      empId,
      invoiceTotal,
      amountPaid,
      paymentMethodId,
      date: dayResolution.dateYmd,
      createdByUserId: auth.userId,
      branchId: branch.branchId,
      businessDayId: dayResolution.day.id,
    });

    scheduleEmployeeTipWhatsApp({
      empId,
      employeeName: result.employeeName,
      invID: result.invID,
      tipAmount: result.tipAmount,
      invoiceTotal: result.invoiceTotal,
      amountPaid: result.amountPaid,
      newBalance: result.newBalance,
      paymentMethodId,
    });

    return NextResponse.json({ ...result, tipWhatsApp: true }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof EmployeeTipError) {
      const status = error.message.includes('EMP_LEDGER_DUAL_WRITE_ENABLED')
        ? 503
        : error.message.includes('add-employee-ledger-tip-reason')
          ? 503
          : 400;
      return NextResponse.json({ error: error.message }, { status });
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[api/pos/tips] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
