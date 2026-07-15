import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import {
  EmployeeDailyTargetLedgerConflictError,
  EmployeeTargetValidationError,
  parseTargetLedgerSyncBody,
  reconcileEmployeeDailyTargetLedger,
} from '@/lib/payroll/employee-target';

function isMissingTableError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    (lower.includes('tblempledgerentry') || lower.includes('tblempdailytarget')) &&
    (lower.includes('invalid object name') || lower.includes('does not exist'))
  );
}

/**
 * POST /api/payroll/daily/targets/ledger-sync
 * Body: { workDate } | { year, month } + optional empIds + dryRun (default true)
 * Admin tool — dry-run by default; repair when dryRun=false.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
    }

    let parsed;
    try {
      parsed = parseTargetLedgerSyncBody(body);
    } catch (e: unknown) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'بيانات غير صالحة' },
        { status: 400 },
      );
    }

    const result = await reconcileEmployeeDailyTargetLedger(parsed, auth.userId ?? null);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err: unknown) {
    if (err instanceof EmployeeTargetValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof EmployeeDailyTargetLedgerConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (isMissingTableError(message)) {
      return NextResponse.json(
        { error: 'جدول التارجت أو الدفتر غير موجود — نفّذ الهجرات المطلوبة' },
        { status: 503 },
      );
    }
    console.error('[api/payroll/daily/targets/ledger-sync] POST error:', message);
    return NextResponse.json({ error: 'تعذّرت مزامنة/مراجعة قيود التارجت' }, { status: 500 });
  }
}
