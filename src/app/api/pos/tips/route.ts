import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { scheduleEmployeeTipWhatsApp } from '@/lib/services/employeeAdvanceWhatsAppNotify';
import {
  EmployeeTipError,
  executeEmployeeTip,
} from '@/lib/services/employeeTipService';
import { resolveBranchDayAndShiftForWrite } from '@/lib/branch/operationalGates';
import { finalizeCurrentFinancialWrite } from '@/lib/branch/financialOwnershipPolicy';

/**
 * POST /api/pos/tips
 * Record tip from overpayment: cash-in (تبس) + employee ledger credit.
 *
 * Body: { empId, invoiceTotal, amountPaid, paymentMethodId }
 *
 * Date/branch ownership always come from the OPEN ShiftSession (operational
 * branch), never ViewBranch or a browser calendar date.
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

    // Ownership comes from OPEN ShiftSession (operational branch), not ViewBranch.
    const gated = await resolveBranchDayAndShiftForWrite(auth.userId);
    if (!gated.ok) return gated.response;
    const owned = finalizeCurrentFinancialWrite('pos.tip', gated, body);
    if (!owned.ok) return owned.response;
    if (!gated.shift || owned.ownership.shiftMoveId == null) {
      return NextResponse.json(
        { error: 'لا يوجد وردية مفتوحة لهذا المستخدم — لا يمكن تسجيل بقشيش', code: 'NO_OPEN_SHIFT' },
        { status: 400 },
      );
    }

    const result = await executeEmployeeTip({
      empId,
      invoiceTotal,
      amountPaid,
      paymentMethodId,
      date: owned.ownership.businessDate!,
      createdByUserId: auth.userId,
      branchId: owned.ownership.branchId,
      businessDayId: owned.ownership.businessDayId,
      shiftMoveId: owned.ownership.shiftMoveId,
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
