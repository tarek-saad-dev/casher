import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { EmployeeLedgerDualWriteError } from '@/lib/services/employeeLedgerDualWrite';
import {
  buildEmployeeFundingReconciliation,
  runEmployeeFundingBackfill,
} from '@/lib/services/employeeLedgerFundingBackfillService';

/**
 * GET /api/admin/hr/employee-ledger/funding-backfill?month=YYYY-MM&empId=
 * Reconciliation-only (no writes).
 */
export async function GET(request: NextRequest) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const month = String(searchParams.get('month') ?? '').trim();
    const empRaw = searchParams.get('empId');
    const empId = empRaw != null && empRaw !== '' ? Number(empRaw) : null;

    if (!month) {
      return NextResponse.json({ error: 'month مطلوب بصيغة YYYY-MM' }, { status: 400 });
    }
    if (empId != null && (Number.isNaN(empId) || empId <= 0)) {
      return NextResponse.json({ error: 'empId غير صالح' }, { status: 400 });
    }

    const reconciliation = await buildEmployeeFundingReconciliation(month, empId);
    const linkedTotal = reconciliation.reduce((s, r) => s + r.linkedRevenueTotal, 0);
    const fundingTotal = reconciliation.reduce((s, r) => s + r.ledgerFundingTotal, 0);

    return NextResponse.json({
      success: true,
      month,
      linkedTotal,
      fundingTotal,
      difference: Math.round((linkedTotal - fundingTotal) * 100) / 100,
      reconciliation,
    });
  } catch (error) {
    if (error instanceof EmployeeLedgerDualWriteError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/admin/hr/employee-ledger/funding-backfill
 * Body: { month, empId?, dryRun? }
 * dryRun defaults to true (preview). Set dryRun:false to apply.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;

  try {
    const body = await request.json();
    const month = String(body.month ?? '').trim();
    const empId = body.empId != null ? Number(body.empId) : null;
    const dryRun = body.dryRun !== false;

    if (!month) {
      return NextResponse.json({ error: 'month مطلوب بصيغة YYYY-MM' }, { status: 400 });
    }
    if (empId != null && (Number.isNaN(empId) || empId <= 0)) {
      return NextResponse.json({ error: 'empId غير صالح' }, { status: 400 });
    }

    const result = await runEmployeeFundingBackfill({
      month,
      empId,
      dryRun,
      createdByUserId: auth.userId,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof EmployeeLedgerDualWriteError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
