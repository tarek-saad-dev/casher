import 'server-only';
import { sql } from '@/lib/db';
import {
  applyInventoryMutation,
  InventoryDomainError,
} from './inventoryMutation.service';
import { isStockTrackedProduct } from './productTracking';

type Tx = sql.Transaction;

export type TransferLineInput = {
  proId: number;
  quantity: number;
};

const TRANSFER_STATUSES = [
  'DRAFT',
  'POSTED',
  'IN_TRANSIT',
  'RECEIVED',
  'CANCELLED',
] as const;

export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

async function loadTransferHead(
  transaction: Tx,
  transferId: number,
): Promise<{
  transferId: number;
  fromBranchId: number;
  toBranchId: number;
  status: string;
  idempotencyKey: string | null;
} | null> {
  const result = await new sql.Request(transaction)
    .input('transferId', sql.Int, transferId)
    .query(`
      SELECT TransferID, FromBranchID, ToBranchID, Status, IdempotencyKey
      FROM dbo.TblInventoryTransfer WITH (UPDLOCK, HOLDLOCK)
      WHERE TransferID = @transferId
    `);
  const row = result.recordset[0];
  if (!row) return null;
  return {
    transferId: Number(row.TransferID),
    fromBranchId: Number(row.FromBranchID),
    toBranchId: Number(row.ToBranchID),
    status: String(row.Status),
    idempotencyKey: row.IdempotencyKey == null ? null : String(row.IdempotencyKey),
  };
}

async function loadTransferLines(
  transaction: Tx,
  transferId: number,
): Promise<Array<{ lineId: number; proId: number; quantity: number }>> {
  const result = await new sql.Request(transaction)
    .input('transferId', sql.Int, transferId)
    .query(`
      SELECT TransferLineID, ProID, Quantity
      FROM dbo.TblInventoryTransferLine
      WHERE TransferID = @transferId
      ORDER BY TransferLineID
    `);
  return result.recordset.map((r: Record<string, unknown>) => ({
    lineId: Number(r.TransferLineID),
    proId: Number(r.ProID),
    quantity: Number(r.Quantity),
  }));
}

export async function createTransferDraft(
  transaction: Tx,
  args: {
    fromBranchId: number;
    toBranchId: number;
    requestedBy: number;
    notes?: string | null;
    lines: TransferLineInput[];
    idempotencyKey?: string | null;
  },
): Promise<number> {
  if (args.fromBranchId === args.toBranchId) {
    throw new InventoryDomainError(
      'SAME_BRANCH',
      'لا يمكن النقل لنفس الفرع',
      400,
    );
  }
  if (!args.lines.length) {
    throw new InventoryDomainError('NO_LINES', 'أضف بنود النقل', 400);
  }

  if (args.idempotencyKey) {
    const existing = await new sql.Request(transaction)
      .input('key', sql.NVarChar(120), args.idempotencyKey)
      .query(`
        SELECT TransferID FROM dbo.TblInventoryTransfer WHERE IdempotencyKey = @key
      `);
    if (existing.recordset[0]) {
      return Number(existing.recordset[0].TransferID);
    }
  }

  const ins = await new sql.Request(transaction)
    .input('fromBranchId', sql.Int, args.fromBranchId)
    .input('toBranchId', sql.Int, args.toBranchId)
    .input('requestedBy', sql.Int, args.requestedBy)
    .input('notes', sql.NVarChar(400), args.notes ?? null)
    .input('idempotencyKey', sql.NVarChar(120), args.idempotencyKey ?? null)
    .query(`
      INSERT INTO dbo.TblInventoryTransfer (
        FromBranchID, ToBranchID, Status, RequestedBy, Notes, IdempotencyKey, CreatedAt
      )
      OUTPUT INSERTED.TransferID
      VALUES (
        @fromBranchId, @toBranchId, N'DRAFT', @requestedBy, @notes, @idempotencyKey, SYSUTCDATETIME()
      )
    `);
  const transferId = Number(ins.recordset[0].TransferID);

  for (const line of args.lines) {
    const qty = Number(line.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new InventoryDomainError('INVALID_QTY', 'كمية النقل يجب أن تكون أكبر من صفر', 400);
    }
    await new sql.Request(transaction)
      .input('transferId', sql.Int, transferId)
      .input('proId', sql.Int, line.proId)
      .input('qty', sql.Decimal(10, 2), qty)
      .query(`
        INSERT INTO dbo.TblInventoryTransferLine (TransferID, ProID, Quantity)
        VALUES (@transferId, @proId, @qty)
      `);
  }

  return transferId;
}

/**
 * Post/dispatch: TRANSFER_OUT from source. Status → IN_TRANSIT.
 * Stock leaves source immediately; destination receives only on receiveTransfer.
 */
export async function postTransfer(
  transaction: Tx,
  args: {
    transferId: number;
    actorUserId: number;
    /** Session must own/authorize the source branch. */
    authorizedFromBranchId: number;
  },
): Promise<void> {
  const head = await loadTransferHead(transaction, args.transferId);
  if (!head) {
    throw new InventoryDomainError('TRANSFER_NOT_FOUND', 'النقل غير موجود', 404);
  }
  if (head.fromBranchId !== args.authorizedFromBranchId) {
    throw new InventoryDomainError('TRANSFER_FORBIDDEN', 'غير مصرح بترحيل نقل من هذا الفرع', 403);
  }
  if (head.status === 'IN_TRANSIT' || head.status === 'POSTED') {
    return; // idempotent re-post
  }
  if (head.status === 'RECEIVED') {
    throw new InventoryDomainError('ALREADY_RECEIVED', 'تم استلام هذا النقل مسبقاً', 409);
  }
  if (head.status === 'CANCELLED') {
    throw new InventoryDomainError('TRANSFER_CANCELLED', 'النقل ملغى', 409);
  }
  if (head.status !== 'DRAFT') {
    throw new InventoryDomainError('INVALID_STATUS', `حالة النقل غير صالحة: ${head.status}`, 409);
  }

  const lines = await loadTransferLines(transaction, args.transferId);
  for (const line of lines) {
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
      branchId: head.fromBranchId,
      proId: line.proId,
      quantityDelta: -line.quantity,
      movementType: 'TRANSFER_OUT',
      referenceType: 'TRANSFER',
      referenceId: String(args.transferId),
      referenceLineId: String(line.lineId),
      userId: args.actorUserId,
      reason: 'Inter-branch transfer out',
      idempotencyKey: `TRANSFER_OUT:${args.transferId}:${line.lineId}`,
      allowNegativeOverride: false,
    });
  }

  await new sql.Request(transaction)
    .input('transferId', sql.Int, args.transferId)
    .input('postedBy', sql.Int, args.actorUserId)
    .query(`
      UPDATE dbo.TblInventoryTransfer
      SET Status = N'IN_TRANSIT',
          PostedBy = @postedBy,
          PostedAt = SYSUTCDATETIME()
      WHERE TransferID = @transferId
    `);
}

/**
 * Receive at destination: TRANSFER_IN. Prevents double receive.
 */
export async function receiveTransfer(
  transaction: Tx,
  args: {
    transferId: number;
    actorUserId: number;
    authorizedToBranchId: number;
  },
): Promise<void> {
  const head = await loadTransferHead(transaction, args.transferId);
  if (!head) {
    throw new InventoryDomainError('TRANSFER_NOT_FOUND', 'النقل غير موجود', 404);
  }
  if (head.toBranchId !== args.authorizedToBranchId) {
    throw new InventoryDomainError('TRANSFER_FORBIDDEN', 'غير مصرح باستلام نقل لهذا الفرع', 403);
  }
  if (head.status === 'RECEIVED') {
    return; // idempotent
  }
  if (head.status === 'CANCELLED') {
    throw new InventoryDomainError('TRANSFER_CANCELLED', 'النقل ملغى', 409);
  }
  if (head.status !== 'IN_TRANSIT' && head.status !== 'POSTED') {
    throw new InventoryDomainError(
      'NOT_IN_TRANSIT',
      'يجب ترحيل النقل من الفرع المصدر قبل الاستلام',
      409,
    );
  }

  const lines = await loadTransferLines(transaction, args.transferId);
  for (const line of lines) {
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
      branchId: head.toBranchId,
      proId: line.proId,
      quantityDelta: line.quantity,
      movementType: 'TRANSFER_IN',
      referenceType: 'TRANSFER',
      referenceId: String(args.transferId),
      referenceLineId: String(line.lineId),
      userId: args.actorUserId,
      reason: 'Inter-branch transfer in',
      idempotencyKey: `TRANSFER_IN:${args.transferId}:${line.lineId}`,
    });
  }

  await new sql.Request(transaction)
    .input('transferId', sql.Int, args.transferId)
    .input('receivedBy', sql.Int, args.actorUserId)
    .query(`
      UPDATE dbo.TblInventoryTransfer
      SET Status = N'RECEIVED',
          ReceivedBy = @receivedBy,
          ReceivedAt = SYSUTCDATETIME()
      WHERE TransferID = @transferId
    `);
}

export async function cancelTransferDraft(
  transaction: Tx,
  args: { transferId: number; authorizedFromBranchId: number },
): Promise<void> {
  const head = await loadTransferHead(transaction, args.transferId);
  if (!head) {
    throw new InventoryDomainError('TRANSFER_NOT_FOUND', 'النقل غير موجود', 404);
  }
  if (head.fromBranchId !== args.authorizedFromBranchId) {
    throw new InventoryDomainError('TRANSFER_FORBIDDEN', 'غير مصرح', 403);
  }
  if (head.status !== 'DRAFT') {
    throw new InventoryDomainError(
      'CANCEL_NOT_ALLOWED',
      'يمكن إلغاء المسودات فقط — النقل المرحّل يحتاج مسار عكسي منفصل',
      409,
    );
  }
  await new sql.Request(transaction)
    .input('transferId', sql.Int, args.transferId)
    .query(`
      UPDATE dbo.TblInventoryTransfer
      SET Status = N'CANCELLED'
      WHERE TransferID = @transferId
    `);
}
