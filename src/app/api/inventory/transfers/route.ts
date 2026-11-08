import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { requireAdmin, isAuthResult } from '@/lib/api-auth';
import {
  requireBranchOperationAccess,
  isActiveBranchContext,
} from '@/lib/branch';
import {
  cancelTransferDraft,
  createTransferDraft,
  postTransfer,
  receiveTransfer,
} from '@/lib/inventory/transferInventory.service';
import { InventoryDomainError } from '@/lib/inventory/inventoryMutation.service';

export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;
  const branch = await requireBranchOperationAccess();
  if (!isActiveBranchContext(branch)) return branch;

  try {
    const db = await getPool();
    const result = await db
      .request()
      .input('branchId', sql.Int, branch.branchId)
      .query(`
        SELECT TOP 100
          t.TransferID AS transferId,
          t.FromBranchID AS fromBranchId,
          fb.BranchName AS fromBranchName,
          t.ToBranchID AS toBranchId,
          tb.BranchName AS toBranchName,
          t.Status AS status,
          t.Notes AS notes,
          t.CreatedAt AS createdAt,
          t.PostedAt AS postedAt,
          t.ReceivedAt AS receivedAt
        FROM dbo.TblInventoryTransfer t
        LEFT JOIN dbo.TblBranch fb ON fb.BranchID = t.FromBranchID
        LEFT JOIN dbo.TblBranch tb ON tb.BranchID = t.ToBranchID
        WHERE t.FromBranchID = @branchId OR t.ToBranchID = @branchId
        ORDER BY t.TransferID DESC
      `);
    return NextResponse.json({ transfers: result.recordset, branchId: branch.branchId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST actions: create | post | receive | cancel
 * Body never supplies mutation BranchID for stock — session branch authorizes source/dest.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;
  const branch = await requireBranchOperationAccess();
  if (!isActiveBranchContext(branch)) return branch;

  try {
    const body = await req.json();
    if (body.branchId != null || body.BranchID != null) {
      return NextResponse.json({ error: 'BranchID في الطلب غير مسموح' }, { status: 400 });
    }

    const action = String(body.action || 'create');
    const db = await getPool();
    const transaction = new sql.Transaction(db);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    try {
      if (action === 'create') {
        const fromBranchId = Number(body.fromBranchId ?? branch.branchId);
        const toBranchId = Number(body.toBranchId);
        if (fromBranchId !== branch.branchId) {
          await transaction.rollback();
          return NextResponse.json(
            { error: 'إنشاء النقل مسموح من الفرع النشط فقط كمصدر' },
            { status: 403 },
          );
        }
        const transferId = await createTransferDraft(transaction, {
          fromBranchId,
          toBranchId,
          requestedBy: auth.userId,
          notes: body.notes ?? null,
          lines: body.lines || [],
          idempotencyKey: body.idempotencyKey ?? null,
        });
        if (body.post) {
          await postTransfer(transaction, {
            transferId,
            actorUserId: auth.userId,
            authorizedFromBranchId: branch.branchId,
          });
        }
        await transaction.commit();
        return NextResponse.json({ transferId, status: body.post ? 'IN_TRANSIT' : 'DRAFT' }, { status: 201 });
      }

      const transferId = Number(body.transferId);
      if (!Number.isFinite(transferId)) {
        await transaction.rollback();
        return NextResponse.json({ error: 'transferId مطلوب' }, { status: 400 });
      }

      if (action === 'post') {
        await postTransfer(transaction, {
          transferId,
          actorUserId: auth.userId,
          authorizedFromBranchId: branch.branchId,
        });
        await transaction.commit();
        return NextResponse.json({ ok: true, transferId, status: 'IN_TRANSIT' });
      }

      if (action === 'receive') {
        await receiveTransfer(transaction, {
          transferId,
          actorUserId: auth.userId,
          authorizedToBranchId: branch.branchId,
        });
        await transaction.commit();
        return NextResponse.json({ ok: true, transferId, status: 'RECEIVED' });
      }

      if (action === 'cancel') {
        await cancelTransferDraft(transaction, {
          transferId,
          authorizedFromBranchId: branch.branchId,
        });
        await transaction.commit();
        return NextResponse.json({ ok: true, transferId, status: 'CANCELLED' });
      }

      await transaction.rollback();
      return NextResponse.json({ error: 'إجراء غير معروف' }, { status: 400 });
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (err: unknown) {
    if (err instanceof InventoryDomainError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode },
      );
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
