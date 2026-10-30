import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { requireBranchOperationAccess, isActiveBranchContext } from '@/lib/branch/context';
import { listUserValidBranchAccess, listActiveBranches } from '@/lib/branch/repository';
import {
  EmployeeLedgerAdditionalTargetError,
  postAdditionalTarget,
  previewAdditionalTarget,
} from '@/lib/services/employeeLedgerAdditionalTargetService';

async function resolveAccessibleBranchIds(userId: number, sessionBranchId: number): Promise<number[]> {
  const [access, active] = await Promise.all([
    listUserValidBranchAccess(userId),
    listActiveBranches(),
  ]);
  const activeIds = new Set(active.map((b) => b.branchId));
  const ids = access
    .filter(
      (a) =>
        activeIds.has(a.branchId) &&
        (a.canOperate || a.canSwitch || a.canViewReports || a.isDefault),
    )
    .map((a) => a.branchId);
  if (!ids.includes(sessionBranchId)) ids.push(sessionBranchId);
  return [...new Set(ids)].sort((a, b) => a - b);
}

function parsePositiveInt(raw: unknown, label: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new EmployeeLedgerAdditionalTargetError(`${label} غير صالح`);
  }
  return Math.trunc(n);
}

/**
 * GET /api/admin/hr/employee-ledger/additional-target?empId=&branchId=&date=
 * Preview current day/month target totals before adding a bonus-style additional target.
 */
export async function GET(request: NextRequest) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;

  try {
    const branch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(branch)) return branch;

    const { searchParams } = new URL(request.url);
    const empId = parsePositiveInt(searchParams.get('empId'), 'الموظف');
    const branchId = parsePositiveInt(searchParams.get('branchId'), 'الفرع');
    const entryDate = String(searchParams.get('date') ?? '').trim();

    const accessible = await resolveAccessibleBranchIds(branch.userId, branch.branchId);
    if (!accessible.includes(branchId)) {
      return NextResponse.json({ error: 'غير مصرح بالوصول لهذا الفرع' }, { status: 403 });
    }

    const preview = await previewAdditionalTarget({ empId, branchId, entryDate });
    return NextResponse.json(preview);
  } catch (error: unknown) {
    if (error instanceof EmployeeLedgerAdditionalTargetError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[api/admin/hr/employee-ledger/additional-target] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/admin/hr/employee-ledger/additional-target
 * Credit additional target (bonus) for emp + branch + date. No cash move.
 * Body branchId is allowed but must be in the caller's accessible branches.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;

  try {
    const branch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(branch)) return branch;

    const body = await request.json();
    const empId = parsePositiveInt(body.empId, 'الموظف');
    const branchId = parsePositiveInt(body.branchId, 'الفرع');
    const amount = Number(body.amount);
    const entryDate = String(body.date ?? body.entryDate ?? '').trim();
    const notes = body.notes != null ? String(body.notes) : undefined;

    const accessible = await resolveAccessibleBranchIds(branch.userId, branch.branchId);
    if (!accessible.includes(branchId)) {
      return NextResponse.json({ error: 'غير مصرح بالوصول لهذا الفرع' }, { status: 403 });
    }

    const result = await postAdditionalTarget({
      empId,
      branchId,
      entryDate,
      amount,
      notes,
      createdByUserId: auth.userId,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof EmployeeLedgerAdditionalTargetError) {
      const status = error.message.includes('EMP_LEDGER_DUAL_WRITE_ENABLED') ? 503 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[api/admin/hr/employee-ledger/additional-target] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
