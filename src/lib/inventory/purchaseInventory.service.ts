import 'server-only';
import { sql } from '@/lib/db';
import {
  applyInventoryMutation,
  InventoryDomainError,
} from './inventoryMutation.service';
import { isStockTrackedProduct } from './productTracking';

export { InventoryDomainError };
export type PurchaseLineInput = {
  proId: number;
  qty: number;
  unitPrice: number;
  notes?: string | null;
};

/**
 * Post a DRAFT purchase: set PostStatus=POSTED and receive stock.
 * BranchID must already be stamped from session at create time.
 */
export async function postPurchaseReceipt(
  transaction: sql.Transaction,
  args: {
    branchId: number;
    purchaseInvId: number;
    purchaseInvType: string;
    userId: number | null;
    businessDayId?: number | null;
    shiftMoveId?: number | null;
    lines: PurchaseLineInput[];
  },
): Promise<void> {
  const head = await new sql.Request(transaction)
    .input('invId', sql.Int, args.purchaseInvId)
    .input('invType', sql.NVarChar(20), args.purchaseInvType)
    .query(`
      SELECT BranchID, PostStatus
      FROM dbo.TblinvPurchaseHead
      WHERE invID = @invId AND invType = @invType
    `);
  const row = head.recordset[0] as
    | { BranchID: number; PostStatus: string }
    | undefined;
  if (!row) {
    throw new InventoryDomainError('PURCHASE_NOT_FOUND', 'غير موجود', 404);
  }
  if (Number(row.BranchID) !== Number(args.branchId)) {
    throw new InventoryDomainError('PURCHASE_NOT_FOUND', 'غير موجود', 404);
  }
  if (String(row.PostStatus).toUpperCase() === 'POSTED') {
    // Idempotent: already posted — stock movements keyed; re-apply is no-op
  } else if (String(row.PostStatus).toUpperCase() === 'CANCELLED') {
    throw new InventoryDomainError('PURCHASE_CANCELLED', 'لا يمكن ترحيل مشتريات ملغاة', 409);
  }

  for (let i = 0; i < args.lines.length; i++) {
    const line = args.lines[i]!;
    const qty = Number(line.qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;

    const flags = await new sql.Request(transaction)
      .input('proId', sql.Int, line.proId)
      .query(`
        SELECT p.ProType, c.CatType
        FROM dbo.TblPro p
        LEFT JOIN dbo.TblCat c ON c.CatID = p.CatID
        WHERE p.ProID = @proId
      `);
    const f = flags.recordset[0] as { ProType: string | null; CatType: string | null } | undefined;
    if (!f || !isStockTrackedProduct({ proId: line.proId, proType: f.ProType, catType: f.CatType })) {
      continue;
    }

    await applyInventoryMutation(transaction, {
      branchId: args.branchId,
      proId: line.proId,
      quantityDelta: qty,
      movementType: 'PURCHASE_RECEIPT',
      referenceType: 'PURCHASE',
      referenceId: `${args.purchaseInvType}:${args.purchaseInvId}`,
      referenceLineId: `${i}:${line.proId}`,
      businessDayId: args.businessDayId,
      shiftMoveId: args.shiftMoveId,
      userId: args.userId,
      reason: 'Purchase receipt',
      idempotencyKey: `PURCHASE_RECEIPT:${args.branchId}:${args.purchaseInvType}:${args.purchaseInvId}:${i}:${line.proId}`,
    });
  }

  await new sql.Request(transaction)
    .input('invId', sql.Int, args.purchaseInvId)
    .input('invType', sql.NVarChar(20), args.purchaseInvType)
    .input('branchId', sql.Int, args.branchId)
    .query(`
      UPDATE dbo.TblinvPurchaseHead
      SET PostStatus = N'POSTED'
      WHERE invID = @invId AND invType = @invType AND BranchID = @branchId
    `);
}

export async function applyManualStockAdjustment(
  transaction: sql.Transaction,
  args: {
    branchId: number;
    proId: number;
    /** Positive = increase, negative = decrease. For set-count, pass (target - current). */
    quantityDelta: number;
    reason: string;
    userId: number;
    businessDayId?: number | null;
    shiftMoveId?: number | null;
    setCountedTo?: number | null;
  },
): Promise<{ quantityBefore: number; quantityAfter: number; movementId: number | null }> {
  if (!args.reason || !args.reason.trim()) {
    throw new InventoryDomainError('REASON_REQUIRED', 'سبب التعديل مطلوب', 400);
  }

  let delta = Number(args.quantityDelta);
  if (args.setCountedTo != null && Number.isFinite(Number(args.setCountedTo))) {
    const { ensureBranchInventoryBalance } = await import('./inventoryMutation.service');
    await ensureBranchInventoryBalance(transaction, args.branchId, args.proId);
    const cur = await new sql.Request(transaction)
      .input('branchId', sql.Int, args.branchId)
      .input('proId', sql.Int, args.proId)
      .query(`
        SELECT QtyOnHand FROM dbo.TblBranchInventory WITH (UPDLOCK, HOLDLOCK)
        WHERE BranchID = @branchId AND ProID = @proId
      `);
    const before = Number(cur.recordset[0]?.QtyOnHand ?? 0);
    delta = Number(args.setCountedTo) - before;
  }

  if (!Number.isFinite(delta) || delta === 0) {
    throw new InventoryDomainError('INVALID_DELTA', 'لا يوجد تغيير في الكمية', 400);
  }

  const movementType =
    args.setCountedTo != null
      ? 'STOCK_COUNT_ADJUSTMENT'
      : delta > 0
        ? 'MANUAL_ADJUSTMENT_IN'
        : 'MANUAL_ADJUSTMENT_OUT';

  const key = `ADJ:${args.branchId}:${args.proId}:${args.userId}:${Date.now()}:${delta}:${args.reason.slice(0, 40)}`;
  // Prefer deterministic key when caller retries — include rounded target
  const idem =
    args.setCountedTo != null
      ? `ADJ_SET:${args.branchId}:${args.proId}:${Number(args.setCountedTo)}:${args.reason.trim()}`
      : key;

  const res = await applyInventoryMutation(transaction, {
    branchId: args.branchId,
    proId: args.proId,
    quantityDelta: delta,
    movementType,
    referenceType: 'MANUAL_ADJUSTMENT',
    referenceId: String(args.userId),
    userId: args.userId,
    businessDayId: args.businessDayId,
    shiftMoveId: args.shiftMoveId,
    reason: args.reason.trim(),
    idempotencyKey: idem.slice(0, 120),
    allowNegativeOverride: false,
  });

  return {
    quantityBefore: res.quantityBefore,
    quantityAfter: res.quantityAfter,
    movementId: res.movementId,
  };
}
