import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireAdmin, requirePageAccess } from '@/lib/api-auth';
import { requireBranchOperationAccess, isActiveBranchContext } from '@/lib/branch/context';
import { listUserValidBranchAccess, listActiveBranches } from '@/lib/branch/repository';
import { resolveBranchDayForDate } from '@/lib/branch/operationalGates';
import {
  EmployeeLedgerInterBranchSettlementError,
  executeInterBranchSettlement,
  listInterBranchSettlements,
  previewInterBranchSettlement,
  voidInterBranchSettlement,
  type SettlementType,
} from '@/lib/services/employeeLedgerInterBranchSettlementService';

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
  return [...new Set(ids)];
}

function parsePositiveInt(raw: unknown, label: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new EmployeeLedgerInterBranchSettlementError(`${label} غير صالح`);
  }
  return Math.trunc(n);
}

/**
 * GET ?empId=&sourceBranchId=&destBranchId=
 * Preview settleable pairs / selected pair.
 * GET ?empId=&list=1 — settlement history
 */
export async function GET(request: NextRequest) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;

  try {
    const branch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(branch)) return branch;

    const { searchParams } = new URL(request.url);
    const empId = parsePositiveInt(searchParams.get('empId'), 'الموظف');

    if (searchParams.get('list') === '1') {
      const rows = await listInterBranchSettlements({ empId });
      return NextResponse.json({ empId, settlements: rows });
    }

    const sourceRaw = searchParams.get('sourceBranchId');
    const destRaw = searchParams.get('destBranchId');
    const preview = await previewInterBranchSettlement({
      empId,
      sourceBranchId: sourceRaw ? parsePositiveInt(sourceRaw, 'فرع المصدر') : null,
      destBranchId: destRaw ? parsePositiveInt(destRaw, 'فرع الوجهة') : null,
    });
    return NextResponse.json(preview);
  } catch (error: unknown) {
    if (error instanceof EmployeeLedgerInterBranchSettlementError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[inter-branch-settlement GET]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST — execute settlement (admin only).
 * Body: empId, sourceBranchId, destBranchId, amount, date, settlementType,
 *       paymentMethodId?, notes?, idempotencyKey?
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;
  const page = await requirePageAccess('/admin/hr');
  if (!isAuthResult(page)) return page;

  try {
    const sessionBranch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(sessionBranch)) return sessionBranch;

    const body = await request.json();
    const empId = parsePositiveInt(body.empId, 'الموظف');
    const sourceBranchId = parsePositiveInt(body.sourceBranchId, 'فرع المصدر');
    const destBranchId = parsePositiveInt(body.destBranchId, 'فرع الوجهة');
    const amount = Number(body.amount);
    const settlementDate = String(body.date ?? body.settlementDate ?? '').trim();
    const settlementType = String(body.settlementType ?? 'ledger_only') as SettlementType;
    if (settlementType !== 'cash_transfer' && settlementType !== 'ledger_only') {
      throw new EmployeeLedgerInterBranchSettlementError('نوع التسوية غير صالح');
    }

    const accessible = await resolveAccessibleBranchIds(
      sessionBranch.userId,
      sessionBranch.branchId,
    );
    if (!accessible.includes(sourceBranchId) || !accessible.includes(destBranchId)) {
      return NextResponse.json({ error: 'غير مصرح بالوصول لأحد الفرعين' }, { status: 403 });
    }

    const sourceDay = await resolveBranchDayForDate(sourceBranchId, settlementDate);
    if (!sourceDay.ok) return sourceDay.response;
    const destDay = await resolveBranchDayForDate(destBranchId, settlementDate);
    if (!destDay.ok) return destDay.response;

    const result = await executeInterBranchSettlement({
      empId,
      sourceBranchId,
      destBranchId,
      amount,
      settlementDate,
      settlementType,
      paymentMethodId:
        body.paymentMethodId != null ? Number(body.paymentMethodId) : null,
      sourceBusinessDayId: sourceDay.day.id,
      destBusinessDayId: destDay.day.id,
      notes: body.notes != null ? String(body.notes) : undefined,
      idempotencyKey: body.idempotencyKey != null ? String(body.idempotencyKey) : undefined,
      createdByUserId: auth.userId,
    });

    return NextResponse.json(result, { status: result.idempotentReplay ? 200 : 201 });
  } catch (error: unknown) {
    if (error instanceof EmployeeLedgerInterBranchSettlementError) {
      const status = error.message.includes('EMP_LEDGER_DUAL_WRITE_ENABLED') ? 503 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[inter-branch-settlement POST]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE — void settlement via reversal transaction (admin only).
 * Body: settlementId, voidReason, date?
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;
  const page = await requirePageAccess('/admin/hr');
  if (!isAuthResult(page)) return page;

  try {
    const body = await request.json();
    const settlementId = parsePositiveInt(body.settlementId, 'رقم التسوية');
    const voidReason = String(body.voidReason ?? '').trim();
    const settlementDate = String(body.date ?? '').trim();

    const dbPreview = await previewForVoid(settlementId);
    const date = settlementDate || dbPreview.settlementDate;

    const sourceDay = await resolveBranchDayForDate(dbPreview.sourceBranchId, date);
    if (!sourceDay.ok) return sourceDay.response;
    const destDay = await resolveBranchDayForDate(dbPreview.destBranchId, date);
    if (!destDay.ok) return destDay.response;

    const result = await voidInterBranchSettlement({
      settlementId,
      voidReason,
      voidedByUserId: auth.userId,
      sourceBusinessDayId: sourceDay.day.id,
      destBusinessDayId: destDay.day.id,
      paymentMethodId:
        body.paymentMethodId != null ? Number(body.paymentMethodId) : null,
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof EmployeeLedgerInterBranchSettlementError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[inter-branch-settlement DELETE]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function previewForVoid(settlementId: number): Promise<{
  sourceBranchId: number;
  destBranchId: number;
  settlementDate: string;
  empId: number;
}> {
  const { getPool, sql } = await import('@/lib/db');
  const db = await getPool();
  const r = await db
    .request()
    .input('id', sql.BigInt, settlementId)
    .query(`
      SELECT EmpID, SourceBranchID, DestBranchID,
             CONVERT(varchar(10), SettlementDate, 23) AS SettlementDate
      FROM dbo.TblEmpBranchSettlement
      WHERE SettlementID = @id
    `);
  const row = r.recordset[0];
  if (!row) {
    throw new EmployeeLedgerInterBranchSettlementError('التسوية غير موجودة');
  }
  return {
    empId: Number(row.EmpID),
    sourceBranchId: Number(row.SourceBranchID),
    destBranchId: Number(row.DestBranchID),
    settlementDate: String(row.SettlementDate),
  };
}
