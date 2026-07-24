import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import {
  isActiveBranchContext,
  requireBranchOperationAccess,
  resolveBranchDayAndShiftForWrite,
} from '@/lib/branch';
import { getSession } from '@/lib/session';
import {
  postPurchaseReceipt,
  InventoryDomainError,
  type PurchaseLineInput,
} from '@/lib/inventory/purchaseInventory.service';

export const runtime = 'nodejs';

/**
 * GET /api/purchases — list purchases for active branch only.
 */
export async function GET() {
  try {
    const branch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(branch)) return branch;
    const db = await getPool();
    const result = await db
      .request()
      .input('branchId', sql.Int, branch.branchId)
      .query(`
        SELECT TOP 100
          invID, invType, invDate, GrandTotal, PostStatus, BranchID, Notes, UserID
        FROM dbo.TblinvPurchaseHead
        WHERE BranchID = @branchId
        ORDER BY invDate DESC, invID DESC
      `);
    return NextResponse.json({ purchases: result.recordset });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/purchases — create DRAFT purchase (no stock) or create+post.
 * Body: { lines: [{proId,qty,unitPrice}], notes?, post?: boolean }
 * BranchID never from body.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.UserID) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const gated = await resolveBranchDayAndShiftForWrite(session.UserID);
    if (!gated.ok) return gated.response;
    const branchId = gated.branch.branchId;

    const body = await req.json();
    if (body.branchId != null || body.BranchID != null) {
      return NextResponse.json({ error: 'BranchID في الطلب غير مسموح' }, { status: 400 });
    }

    const lines = (body.lines || []) as PurchaseLineInput[];
    if (!Array.isArray(lines) || lines.length === 0) {
      return NextResponse.json({ error: 'أضف بنود المشتريات' }, { status: 400 });
    }

    const shouldPost = Boolean(body.post);
    const invType = 'مشتريات';
    const notes = String(body.notes || 'مشتريات').slice(0, 100);
    const totalQty = lines.reduce((s, l) => s + Math.max(0, Number(l.qty) || 0), 0);
    const subTotal = lines.reduce(
      (s, l) => s + Math.max(0, Number(l.qty) || 0) * Math.max(0, Number(l.unitPrice) || 0),
      0,
    );

    const db = await getPool();
    const transaction = new sql.Transaction(db);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      const idRes = await new sql.Request(transaction)
        .input('invType', sql.NVarChar(20), invType)
        .query(`
          SELECT ISNULL(MAX(invID), 0) + 1 AS newInvID
          FROM dbo.TblinvPurchaseHead WITH (UPDLOCK, HOLDLOCK)
          WHERE invType = @invType
        `);
      const purchaseInvId = Number(idRes.recordset[0].newInvID);

      const now = new Date();
      const invTime = `${String(now.getHours()).padStart(2, '0')}.${String(now.getMinutes()).padStart(2, '0')}`;
      const invDate = gated.day.newDay;

      await new sql.Request(transaction)
        .input('invID', sql.Int, purchaseInvId)
        .input('invType', sql.NVarChar(20), invType)
        .input('invDate', sql.Date, invDate)
        .input('invTime', sql.NVarChar(50), invTime)
        .input('UserID', sql.Int, session.UserID)
        .input('TotalQty', sql.Decimal(10, 2), totalQty)
        .input('SubTotal', sql.Decimal(10, 2), subTotal)
        .input('GrandTotal', sql.Decimal(10, 2), subTotal)
        .input('Notes', sql.NVarChar(100), notes)
        .input('ShiftMoveID', sql.Int, gated.shift?.id ?? null)
        .input('BranchID', sql.Int, branchId)
        .input('PostStatus', sql.NVarChar(30), 'DRAFT')
        .query(`
          INSERT INTO dbo.TblinvPurchaseHead (
            invID, invType, invDate, invTime, ClientID, UserID,
            TotalQty, SubTotal, Dis, DisVal, GrandTotal,
            invNotes, ShiftMoveID, Notes, PaymentMethodID,
            BranchID, PostStatus
          ) VALUES (
            @invID, @invType, @invDate, @invTime, NULL, @UserID,
            @TotalQty, @SubTotal, 0, 0, @GrandTotal,
            @Notes, @ShiftMoveID, @Notes, NULL,
            @BranchID, @PostStatus
          )
        `);

      for (const line of lines) {
        await new sql.Request(transaction)
          .input('invID', sql.Int, purchaseInvId)
          .input('invType', sql.NVarChar(20), invType)
          .input('ProID', sql.Int, line.proId)
          .input('Qty', sql.Decimal(10, 2), line.qty)
          .input('PPrice', sql.Decimal(10, 2), line.unitPrice)
          .input('PValue', sql.Decimal(10, 2), Number(line.qty) * Number(line.unitPrice))
          .input('Notes', sql.NVarChar(50), (line.notes || '').slice(0, 50))
          .query(`
            INSERT INTO dbo.TblinvPurchaseDetail (
              invID, invType, ProID, Qty, PPrice, PValue, Notes, Dis, DisVal
            ) VALUES (
              @invID, @invType, @ProID, @Qty, @PPrice, @PValue, @Notes, 0, 0
            )
          `);
      }

      if (shouldPost) {
        await postPurchaseReceipt(transaction, {
          branchId,
          purchaseInvId,
          purchaseInvType: invType,
          userId: session.UserID,
          businessDayId: gated.day.id,
          shiftMoveId: gated.shift?.id ?? null,
          lines,
        });
      }

      await transaction.commit();
      return NextResponse.json(
        {
          invID: purchaseInvId,
          invType,
          branchId,
          postStatus: shouldPost ? 'POSTED' : 'DRAFT',
        },
        { status: 201 },
      );
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
