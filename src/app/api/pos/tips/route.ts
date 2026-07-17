import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { scheduleEmployeeTipWhatsApp } from '@/lib/services/employeeAdvanceWhatsAppNotify';
import {
  EmployeeTipError,
  executeEmployeeTip,
} from '@/lib/services/employeeTipService';

/**
 * POST /api/pos/tips
 * Record tip from overpayment: cash-in (تبس) + employee ledger credit.
 *
 * Body: { empId, invoiceTotal, amountPaid, paymentMethodId, date? }
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
    const date =
      String(body.date ?? '').trim() ||
      new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });

    const result = await executeEmployeeTip({
      empId,
      invoiceTotal,
      amountPaid,
      paymentMethodId,
      date,
      createdByUserId: auth.userId,
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
