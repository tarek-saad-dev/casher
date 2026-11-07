import 'server-only';
import { sql } from '@/lib/db';
import {
  allowNegativeStock,
  isStockTrackedProduct,
  type InventoryMovementType,
} from './productTracking';

export class InventoryDomainError extends Error {
  code: string;
  statusCode: number;
  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export type InventoryMutationInput = {
  branchId: number;
  proId: number;
  quantityDelta: number;
  movementType: InventoryMovementType;
  referenceType: string;
  referenceId: string;
  referenceLineId?: string | null;
  businessDayId?: number | null;
  shiftMoveId?: number | null;
  userId?: number | null;
  reason?: string | null;
  idempotencyKey: string;
  reversalOfMovementId?: number | null;
  /** Override env/tenant policy for a single call (e.g. elevated adjustment). */
  allowNegativeOverride?: boolean;
  /** Optional Arabic context for INSUFFICIENT_STOCK messages. */
  productName?: string | null;
  branchName?: string | null;
};

export type InventoryMutationResult = {
  skipped: boolean;
  reason?: string;
  movementId: number | null;
  branchId: number;
  proId: number;
  quantityBefore: number;
  quantityAfter: number;
  quantityDelta: number;
};

type Tx = sql.Transaction;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Ensure a balance row exists for BranchID+ProID.
 * Missing balance → create zero (never fall back to another branch's qty).
 */
export async function ensureBranchInventoryBalance(
  transaction: Tx,
  branchId: number,
  proId: number,
): Promise<void> {
  const req = new sql.Request(transaction);
  await req
    .input('branchId', sql.Int, branchId)
    .input('proId', sql.Int, proId)
    .query(`
      IF NOT EXISTS (
        SELECT 1 FROM dbo.TblBranchInventory WITH (UPDLOCK, HOLDLOCK)
        WHERE BranchID = @branchId AND ProID = @proId
      )
      BEGIN
        INSERT INTO dbo.TblBranchInventory (BranchID, ProID, QtyOnHand)
        VALUES (@branchId, @proId, 0);
      END
    `);
}

export async function loadProductTrackingFlags(
  transaction: Tx,
  proId: number,
): Promise<{ proType: string | null; catType: string | null } | null> {
  const result = await new sql.Request(transaction).input('proId', sql.Int, proId).query(`
    SELECT p.ProType, c.CatType
    FROM dbo.TblPro p
    LEFT JOIN dbo.TblCat c ON c.CatID = p.CatID
    WHERE p.ProID = @proId
  `);
  const row = result.recordset[0] as { ProType: string | null; CatType: string | null } | undefined;
  if (!row) return null;
  return {
    proType: row.ProType == null ? null : String(row.ProType),
    catType: row.CatType == null ? null : String(row.CatType),
  };
}

/**
 * Sole application entry point for operational stock mutations.
 * Must run inside an existing SQL transaction with the financial/purchase work.
 */
export async function applyInventoryMutation(
  transaction: Tx,
  input: InventoryMutationInput,
): Promise<InventoryMutationResult> {
  const delta = round2(Number(input.quantityDelta));
  if (!Number.isFinite(delta) || delta === 0) {
    throw new InventoryDomainError(
      'INVALID_DELTA',
      'كمية حركة المخزون يجب أن تكون رقمًا غير صفري',
      400,
    );
  }
  if (!input.idempotencyKey || !input.idempotencyKey.trim()) {
    throw new InventoryDomainError('MISSING_IDEMPOTENCY', 'مفتاح التكرار مطلوب', 400);
  }
  if (!input.branchId || !input.proId) {
    throw new InventoryDomainError('MISSING_KEYS', 'الفرع والمنتج مطلوبان', 400);
  }

  // Idempotent short-circuit
  const existing = await new sql.Request(transaction)
    .input('key', sql.NVarChar(120), input.idempotencyKey.trim())
    .query(`
      SELECT TOP 1
        MovementID, BranchID, ProID, QuantityDelta, QuantityBefore, QuantityAfter
      FROM dbo.TblInventoryMovement
      WHERE IdempotencyKey = @key
    `);
  if (existing.recordset[0]) {
    const row = existing.recordset[0];
    return {
      skipped: true,
      reason: 'idempotent_replay',
      movementId: Number(row.MovementID),
      branchId: Number(row.BranchID),
      proId: Number(row.ProID),
      quantityBefore: Number(row.QuantityBefore),
      quantityAfter: Number(row.QuantityAfter),
      quantityDelta: Number(row.QuantityDelta),
    };
  }

  const flags = await loadProductTrackingFlags(transaction, input.proId);
  if (!flags) {
    throw new InventoryDomainError('PRODUCT_NOT_FOUND', 'المنتج غير موجود', 404);
  }
  if (!isStockTrackedProduct({ proId: input.proId, ...flags })) {
    return {
      skipped: true,
      reason: 'not_stock_tracked',
      movementId: null,
      branchId: input.branchId,
      proId: input.proId,
      quantityBefore: 0,
      quantityAfter: 0,
      quantityDelta: 0,
    };
  }

  await ensureBranchInventoryBalance(transaction, input.branchId, input.proId);

  const lockReq = new sql.Request(transaction);
  const locked = await lockReq
    .input('branchId', sql.Int, input.branchId)
    .input('proId', sql.Int, input.proId)
    .query(`
      SELECT BranchInventoryID, QtyOnHand, RowVer
      FROM dbo.TblBranchInventory WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
      WHERE BranchID = @branchId AND ProID = @proId
    `);
  const bal = locked.recordset[0] as
    | { BranchInventoryID: number; QtyOnHand: number; RowVer: Buffer }
    | undefined;
  if (!bal) {
    throw new InventoryDomainError('BALANCE_MISSING', 'رصيد المخزون غير موجود', 500);
  }

  const before = round2(Number(bal.QtyOnHand));
  const after = round2(before + delta);
  const allowNeg =
    input.allowNegativeOverride !== undefined
      ? input.allowNegativeOverride
      : allowNegativeStock();

  if (!allowNeg && after < 0) {
    const productLabel = (input.productName || '').trim() || `المنتج ${input.proId}`;
    const branchLabel = (input.branchName || '').trim();
    const available = before;
    const msg = branchLabel
      ? `الكمية المتاحة من ${productLabel} ${available} فقط في فرع ${branchLabel}.`
      : `الكمية المتاحة من ${productLabel} ${available} فقط في هذا الفرع.`;
    throw new InventoryDomainError('INSUFFICIENT_STOCK', msg, 409);
  }

  await new sql.Request(transaction)
    .input('branchId', sql.Int, input.branchId)
    .input('proId', sql.Int, input.proId)
    .input('qty', sql.Decimal(10, 2), after)
    .query(`
      UPDATE dbo.TblBranchInventory
      SET QtyOnHand = @qty,
          LastMovementAt = SYSUTCDATETIME(),
          UpdatedAt = SYSUTCDATETIME()
      WHERE BranchID = @branchId AND ProID = @proId
    `);

  const ins = await new sql.Request(transaction)
    .input('branchId', sql.Int, input.branchId)
    .input('proId', sql.Int, input.proId)
    .input('delta', sql.Decimal(10, 2), delta)
    .input('before', sql.Decimal(10, 2), before)
    .input('after', sql.Decimal(10, 2), after)
    .input('movementType', sql.NVarChar(40), input.movementType)
    .input('referenceType', sql.NVarChar(40), input.referenceType)
    .input('referenceId', sql.NVarChar(64), String(input.referenceId))
    .input(
      'referenceLineId',
      sql.NVarChar(64),
      input.referenceLineId == null ? null : String(input.referenceLineId),
    )
    .input('businessDayId', sql.Int, input.businessDayId ?? null)
    .input('shiftMoveId', sql.Int, input.shiftMoveId ?? null)
    .input('userId', sql.Int, input.userId ?? null)
    .input('reason', sql.NVarChar(400), input.reason ?? null)
    .input('idempotencyKey', sql.NVarChar(120), input.idempotencyKey.trim())
    .input('reversalOf', sql.BigInt, input.reversalOfMovementId ?? null)
    .query(`
      INSERT INTO dbo.TblInventoryMovement (
        BranchID, ProID, QuantityDelta, QuantityBefore, QuantityAfter,
        MovementType, ReferenceType, ReferenceID, ReferenceLineID,
        BusinessDayID, ShiftMoveID, UserID, Reason, IdempotencyKey, ReversalOfMovementID
      )
      OUTPUT INSERTED.MovementID
      VALUES (
        @branchId, @proId, @delta, @before, @after,
        @movementType, @referenceType, @referenceId, @referenceLineId,
        @businessDayId, @shiftMoveId, @userId, @reason, @idempotencyKey, @reversalOf
      )
    `);

  return {
    skipped: false,
    movementId: Number(ins.recordset[0].MovementID),
    branchId: input.branchId,
    proId: input.proId,
    quantityBefore: before,
    quantityAfter: after,
    quantityDelta: delta,
  };
}

export type SaleStockLine = {
  proId: number;
  qty: number;
  lineKey: string;
};

/**
 * Apply SALE decrements for stock-tracked lines. Idempotent per invoice+line+generation.
 * `generation` must change after each reverse cycle (e.g. max prior SALE MovementID).
 */
export async function applySaleStockDecrements(
  transaction: Tx,
  args: {
    branchId: number;
    invId: number;
    invType: string;
    businessDayId?: number | null;
    shiftMoveId?: number | null;
    userId?: number | null;
    lines: SaleStockLine[];
    /** Disambiguates re-apply after SALE_REVERSAL (default 0 for create). */
    generation?: number;
    allowNegativeOverride?: boolean;
    branchName?: string | null;
  },
): Promise<InventoryMutationResult[]> {
  const generation = args.generation ?? 0;
  const results: InventoryMutationResult[] = [];

  let branchName = args.branchName ?? null;
  if (!branchName) {
    const br = await new sql.Request(transaction)
      .input('branchId', sql.Int, args.branchId)
      .query(`SELECT BranchName FROM dbo.TblBranch WHERE BranchID = @branchId`);
    branchName = br.recordset[0]?.BranchName
      ? String(br.recordset[0].BranchName)
      : null;
  }

  let allowNegativeOverride = args.allowNegativeOverride;
  if (allowNegativeOverride === undefined) {
    try {
      const tenantRes = await new sql.Request(transaction)
        .input('branchId', sql.Int, args.branchId)
        .query(`
          SELECT TOP 1 TenantId
          FROM dbo.Location
          WHERE LegacyBranchId = @branchId AND Status = N'active'
        `);
      const tenantId = tenantRes.recordset[0]?.TenantId
        ? String(tenantRes.recordset[0].TenantId)
        : null;
      if (tenantId) {
        const { allowNegativeStockForTenant } = await import('./stockPolicy.service');
        allowNegativeOverride = await allowNegativeStockForTenant(tenantId);
      }
    } catch {
      // Fall back to env policy inside applyInventoryMutation
    }
  }

  for (const line of args.lines) {
    const qty = round2(Number(line.qty));
    if (!Number.isFinite(qty) || qty <= 0) continue;

    const nameRes = await new sql.Request(transaction)
      .input('proId', sql.Int, line.proId)
      .query(`
        SELECT ISNULL(NULLIF(LTRIM(RTRIM(ProNameAr)), N''), ProName) AS DisplayName
        FROM dbo.TblPro WHERE ProID = @proId
      `);
    const productName = nameRes.recordset[0]?.DisplayName
      ? String(nameRes.recordset[0].DisplayName)
      : null;

    const res = await applyInventoryMutation(transaction, {
      branchId: args.branchId,
      proId: line.proId,
      quantityDelta: -qty,
      movementType: 'SALE',
      referenceType: 'SALE_INVOICE',
      referenceId: `${args.invType}:${args.invId}`,
      referenceLineId: line.lineKey,
      businessDayId: args.businessDayId,
      shiftMoveId: args.shiftMoveId,
      userId: args.userId,
      reason: 'POS sale',
      idempotencyKey: `SALE:${args.branchId}:${args.invType}:${args.invId}:g${generation}:${line.lineKey}`,
      allowNegativeOverride,
      productName,
      branchName,
    });
    results.push(res);
  }
  return results;
}

/**
 * Reverse all unrevesed SALE movements for an invoice (exact ledger reversals).
 * Returns the max SALE MovementID reversed (0 if none) for next generation.
 */
export async function reverseSaleStockMovements(
  transaction: Tx,
  args: {
    branchId: number;
    invId: number;
    invType: string;
    userId?: number | null;
  },
): Promise<{ results: InventoryMutationResult[]; nextGeneration: number }> {
  const refId = `${args.invType}:${args.invId}`;
  const prior = await new sql.Request(transaction)
    .input('branchId', sql.Int, args.branchId)
    .input('refType', sql.NVarChar(40), 'SALE_INVOICE')
    .input('refId', sql.NVarChar(64), refId)
    .query(`
      SELECT m.MovementID, m.ProID, m.QuantityDelta, m.ReferenceLineID, m.IdempotencyKey
      FROM dbo.TblInventoryMovement m
      WHERE m.BranchID = @branchId
        AND m.ReferenceType = @refType
        AND m.ReferenceID = @refId
        AND m.MovementType = N'SALE'
        AND NOT EXISTS (
          SELECT 1 FROM dbo.TblInventoryMovement r
          WHERE r.ReversalOfMovementID = m.MovementID
        )
      ORDER BY m.MovementID
    `);

  const results: InventoryMutationResult[] = [];
  let maxId = 0;
  for (const row of prior.recordset as Array<{
    MovementID: number;
    ProID: number;
    QuantityDelta: number;
    ReferenceLineID: string | null;
    IdempotencyKey: string;
  }>) {
    maxId = Math.max(maxId, Number(row.MovementID));
    const revKey = `SALE_REVERSAL:${row.IdempotencyKey}`;
    const res = await applyInventoryMutation(transaction, {
      branchId: args.branchId,
      proId: Number(row.ProID),
      quantityDelta: -Number(row.QuantityDelta),
      movementType: 'SALE_REVERSAL',
      referenceType: 'SALE_INVOICE',
      referenceId: refId,
      referenceLineId: row.ReferenceLineID,
      userId: args.userId,
      reason: 'Sale cancel/delete/update reversal',
      idempotencyKey: revKey,
      reversalOfMovementId: Number(row.MovementID),
    });
    results.push(res);
  }
  return { results, nextGeneration: maxId };
}

/**
 * Restore stock for a verified customer return against an original sale invoice.
 * Caps restore qty by unrevesed SALE quantity for the product on that invoice.
 */
export async function applyCustomerReturnStockIncrements(
  transaction: Tx,
  args: {
    branchId: number;
    originalInvId: number;
    originalInvType: string;
    returnInvId: number;
    returnInvType: string;
    userId?: number | null;
    lines: SaleStockLine[];
  },
): Promise<InventoryMutationResult[]> {
  const sold = await new sql.Request(transaction)
    .input('branchId', sql.Int, args.branchId)
    .input('refType', sql.NVarChar(40), 'SALE_INVOICE')
    .input('refId', sql.NVarChar(64), `${args.originalInvType}:${args.originalInvId}`)
    .query(`
      SELECT m.ProID, SUM(-m.QuantityDelta) AS SoldQty
      FROM dbo.TblInventoryMovement m
      WHERE m.BranchID = @branchId
        AND m.ReferenceType = @refType
        AND m.ReferenceID = @refId
        AND m.MovementType = N'SALE'
        AND NOT EXISTS (
          SELECT 1 FROM dbo.TblInventoryMovement r
          WHERE r.ReversalOfMovementID = m.MovementID
        )
      GROUP BY m.ProID
    `);
  const soldMap = new Map<number, number>();
  for (const row of sold.recordset as Array<{ ProID: number; SoldQty: number }>) {
    soldMap.set(Number(row.ProID), Number(row.SoldQty));
  }

  const results: InventoryMutationResult[] = [];
  for (const line of args.lines) {
    const qty = round2(Number(line.qty));
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const maxQty = soldMap.get(line.proId) ?? 0;
    if (qty > maxQty) {
      throw new InventoryDomainError(
        'RETURN_QTY_EXCEEDS',
        `لا يمكن إرجاع أكثر من الكمية المباعة (${maxQty}) للمنتج ${line.proId}`,
        409,
      );
    }
    const res = await applyInventoryMutation(transaction, {
      branchId: args.branchId,
      proId: line.proId,
      quantityDelta: qty,
      movementType: 'SALE_REVERSAL',
      referenceType: 'CUSTOMER_RETURN',
      referenceId: `${args.returnInvType}:${args.returnInvId}`,
      referenceLineId: line.lineKey,
      userId: args.userId,
      reason: `Customer return of ${args.originalInvType}:${args.originalInvId}`,
      idempotencyKey: `CUSTOMER_RETURN:${args.branchId}:${args.returnInvType}:${args.returnInvId}:${line.lineKey}`,
    });
    results.push(res);
  }
  return results;
}

export async function getBranchQtyOnHand(
  branchId: number,
  proId: number,
  executor: { request: () => sql.Request },
): Promise<number | null> {
  const result = await executor
    .request()
    .input('branchId', sql.Int, branchId)
    .input('proId', sql.Int, proId)
    .query(`
      SELECT QtyOnHand
      FROM dbo.TblBranchInventory
      WHERE BranchID = @branchId AND ProID = @proId
    `);
  if (!result.recordset[0]) return null;
  return Number(result.recordset[0].QtyOnHand);
}
