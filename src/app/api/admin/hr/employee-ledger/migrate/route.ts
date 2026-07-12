import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { runEmployeeLedgerMigrations } from '@/lib/services/employeeLedgerMigrateService';

export const runtime = 'nodejs';

/**
 * POST /api/admin/hr/employee-ledger/migrate
 * Idempotent schema migration for TblEmpLedgerEntry — table, active-ref unique index,
 * and EntryReason CHECK (includes employee_funding).
 * CLI: pass x-admin-setup-secret header matching ADMIN_SETUP_SECRET, or an authenticated session cookie.
 */
export async function POST(request: NextRequest) {
  const setupSecret = request.headers.get('x-admin-setup-secret');
  if (setupSecret !== process.env.ADMIN_SETUP_SECRET) {
    const auth = await requirePageAccess('/admin/hr');
    if (!isAuthResult(auth)) return auth;
  }

  try {
    const result = await runEmployeeLedgerMigrations();

    if (!result.success) {
      return NextResponse.json(result, { status: 500 });
    }

    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[api/admin/hr/employee-ledger/migrate] POST error:', message);
    return NextResponse.json(
      {
        success: false,
        failedStep: 'create_table',
        sqlError: { message, number: null },
      },
      { status: 500 },
    );
  }
}
