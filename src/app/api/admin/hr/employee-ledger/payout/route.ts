import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import {
  EmployeeLedgerPayoutError,
  executeEmployeePayout,
} from '@/lib/services/employeeLedgerPayoutService';

/**
 * POST /api/admin/hr/employee-ledger/payout
 * Pay employee from ledger balance — creates cash-out + ledger debit in one transaction.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;

  try {
    const body = await request.json();
    const empId = Number(body.empId);
    const amount = Number(body.amount);
    const paymentMethodId = Number(body.paymentMethodId);
    const payoutDate = String(body.payoutDate ?? '').trim();
    const notes = body.notes != null ? String(body.notes) : undefined;
    const allowOverpay = body.allowOverpay === true;

    const result = await executeEmployeePayout({
      empId,
      amount,
      paymentMethodId,
      payoutDate,
      notes,
      allowOverpay,
      createdByUserId: auth.userId,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof EmployeeLedgerPayoutError) {
      const status = error.message.includes('EMP_LEDGER_DUAL_WRITE_ENABLED') ? 503 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[api/admin/hr/employee-ledger/payout] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
