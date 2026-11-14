import 'server-only';
import { createHash } from 'node:crypto';
import type { ConnectionPool, Transaction } from 'mssql';
import { sql } from '@/lib/db';

export type SaleIdempotencyIntent = {
  tenantId: string;
  requestId: string;
  userId: number;
  branchId: number;
  fingerprint: string;
};

export class SaleIdempotencyError extends Error {
  constructor(
    public readonly code: 'IDEMPOTENCY_DISABLED' | 'IDEMPOTENCY_KEY_REQUIRED' |
      'IDEMPOTENCY_KEY_INVALID' | 'IDEMPOTENCY_SCHEMA_UNAVAILABLE' |
      'IDEMPOTENCY_CONFLICT' | 'IDEMPOTENCY_INCONSISTENT',
    message: string,
    public readonly status = 409,
  ) {
    super(message);
    this.name = 'SaleIdempotencyError';
  }
}

export function saleIdempotencyEnabled(): boolean {
  return process.env.POS_SALE_IDEMPOTENCY_ENABLED === 'true';
}
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;

export function createSaleIdempotencyIntent(input: {
  tenantId: string; userId: number; branchId: number;
  rawRequestId: unknown;
  /** The original client POST body; requestId is excluded from the digest. */
  payload: Record<string, unknown>;
}): SaleIdempotencyIntent | null {
  if (!saleIdempotencyEnabled()) {
    if (input.rawRequestId !== undefined && input.rawRequestId !== null) {
      throw new SaleIdempotencyError('IDEMPOTENCY_DISABLED',
        'حماية تكرار الفواتير غير مفعّلة؛ لم يتم حفظ الفاتورة', 503);
    }
    return null;
  }
  if (input.rawRequestId == null) {
    throw new SaleIdempotencyError('IDEMPOTENCY_KEY_REQUIRED',
      'يجب إعادة المحاولة بنفس معرّف الفاتورة', 400);
  }
  if (typeof input.rawRequestId !== 'string' || !UUID_V4.test(input.rawRequestId)) {
    throw new SaleIdempotencyError('IDEMPOTENCY_KEY_INVALID',
      'معرّف حفظ الفاتورة غير صالح', 400);
  }
  if (!input.tenantId || !Number.isInteger(input.userId) || input.userId <= 0 ||
      !Number.isInteger(input.branchId) || input.branchId <= 0) {
    throw new SaleIdempotencyError('IDEMPOTENCY_CONFLICT', 'جلسة الموظف أو الفرع غير صالحة', 403);
  }
  const { requestId: _ignored, ...originalPayload } = input.payload;
  // The same cashier JSON must replay exactly; changed services, payment,
  // coupon, notes or chosen customer require a new sale ID after resolution.
  const fingerprint = createHash('sha256').update(JSON.stringify({
    tenantId: input.tenantId,
    userId: input.userId,
    branchId: input.branchId,
    payload: originalPayload,
  })).digest('hex');
  return {
    tenantId: input.tenantId, userId: input.userId,
    branchId: input.branchId, requestId: input.rawRequestId.toLowerCase(),
    fingerprint,
  };
}

type Row = {
  UserID: number; BranchID: number; PayloadHash: string;
  Status: string; InvID: number | null; InvType: string | null;
};
export type SaleReplay = { invID: number; invType: 'مبيعات'; replayed: true };
export type SaleReservation = { kind: 'new'; intent: SaleIdempotencyIntent } |
  { kind: 'replay'; result: SaleReplay };

function verify(row: Row, input: SaleIdempotencyIntent): void {
  if (Number(row.UserID) !== input.userId ||
      Number(row.BranchID) !== input.branchId ||
      String(row.PayloadHash).trim() !== input.fingerprint) {
    throw new SaleIdempotencyError(
      'IDEMPOTENCY_CONFLICT',
      'نفس معرّف الفاتورة مرتبط ببيانات أو موظف أو فرع مختلف', 409,
    );
  }
  if (row.Status !== 'COMMITTED' || !Number.isSafeInteger(Number(row.InvID)) ||
      Number(row.InvID) <= 0 || row.InvType !== 'مبيعات') {
    throw new SaleIdempotencyError('IDEMPOTENCY_INCONSISTENT',
      'طلب حفظ الفاتورة قيد المعالجة أو حالته غير مكتملة؛ لا تعيد إرسال فاتورة جديدة', 409);
  }
}

async function schemaReady(executor: ConnectionPool | Transaction) {
  const r = await new sql.Request(executor).query(`
    SELECT CASE WHEN OBJECT_ID(N'dbo.TblPosSaleRequest', N'U') IS NOT NULL
      AND COL_LENGTH(N'dbo.TblPosSaleRequest', N'RequestID') IS NOT NULL
      AND COL_LENGTH(N'dbo.TblPosSaleRequest', N'PayloadHash') IS NOT NULL
      AND COL_LENGTH(N'dbo.TblPosSaleRequest', N'InvID') IS NOT NULL
    THEN 1 ELSE 0 END AS Ready;
  `);
  if (Number(r.recordset[0]?.Ready) !== 1) {
    throw new SaleIdempotencyError('IDEMPOTENCY_SCHEMA_UNAVAILABLE',
      'سجل حماية الفواتير غير جاهز', 503);
  }
}

async function confirmedInvoice(
  executor: ConnectionPool | Transaction,
  intent: SaleIdempotencyIntent,
  invID: number,
): Promise<SaleReplay> {
  const r = await new sql.Request(executor)
    .input('tenantId', sql.UniqueIdentifier, intent.tenantId)
    .input('branchId', sql.Int, intent.branchId)
    .input('invId', sql.Int, invID)
    .query(`
      SELECT TOP (1) h.invID
      FROM dbo.TblinvServHead h
      INNER JOIN dbo.Location l ON l.LegacyBranchId = h.BranchID
        AND l.TenantId = @tenantId
      WHERE h.invID = @invId AND h.invType = N'مبيعات'
        AND h.BranchID = @branchId AND ISNULL(h.isActive, N'no') = N'no'
        AND h.GrandTotal > 0 AND h.Payment >= h.GrandTotal
        AND ISNULL(h.PayDue, 0) <= 0;
    `);
  if (r.recordset.length !== 1) {
    // A refunded/deleted invoice must never be silently recreated on retry.
    throw new SaleIdempotencyError('IDEMPOTENCY_INCONSISTENT',
      'الفاتورة القديمة أُلغيت أو تغيّرت؛ لا تُنشئها مرة ثانية بنفس الطلب', 409);
  }
  return { invID, invType: 'مبيعات', replayed: true };
}

function request(executor: ConnectionPool | Transaction, intent: SaleIdempotencyIntent) {
  if (!HASH.test(intent.fingerprint)) {
    throw new SaleIdempotencyError('IDEMPOTENCY_KEY_INVALID', 'بصمة الفاتورة غير صالحة', 400);
  }
  return new sql.Request(executor)
    .input('tenantId', sql.UniqueIdentifier, intent.tenantId)
    .input('requestId', sql.UniqueIdentifier, intent.requestId);
}

/** Early replay probe before checking whether original shift is still OPEN. */
export async function lookupCommittedSaleReplay(
  db: ConnectionPool,
  intent: SaleIdempotencyIntent | null,
): Promise<SaleReplay | null> {
  if (!intent) return null;
  await schemaReady(db);
  const r = await request(db, intent).query(`
    SELECT UserID, BranchID, PayloadHash, Status, InvID, InvType
    FROM dbo.TblPosSaleRequest
    WHERE TenantId = @tenantId AND RequestID = @requestId;
  `);
  if (r.recordset.length === 0) return null;
  if (r.recordset.length !== 1) {
    throw new SaleIdempotencyError('IDEMPOTENCY_INCONSISTENT',
      'طلب مكرر غير متطابق', 409);
  }
  const row = r.recordset[0] as Row;
  verify(row, intent);
  return confirmedInvoice(db, intent, Number(row.InvID));
}

/**
 * SERIALIZABLE transaction owner: reserve BEFORE stock/payment/cash/referral.
 * UPDLOCK,HOLDLOCK on the unique (TenantId, RequestID) key prevents races.
 * All PENDING reservations roll back on a failed sale; none stay committed.
 */
export async function reserveSaleRequest(
  tx: Transaction, intent: SaleIdempotencyIntent | null,
): Promise<SaleReservation | null> {
  if (!intent) return null;
  await schemaReady(tx);
  const r = await request(tx, intent).query(`
    SELECT UserID, BranchID, PayloadHash, Status, InvID, InvType
    FROM dbo.TblPosSaleRequest WITH (UPDLOCK, HOLDLOCK)
    WHERE TenantId = @tenantId AND RequestID = @requestId;
  `);
  if (r.recordset.length === 1) {
    const row = r.recordset[0] as Row;
    verify(row, intent);
    return { kind: 'replay', result: await confirmedInvoice(tx, intent, Number(row.InvID)) };
  }
  if (r.recordset.length !== 0) {
    throw new SaleIdempotencyError('IDEMPOTENCY_INCONSISTENT',
      'تعارض في سجل طلبات البيع', 409);
  }
  const created = await request(tx, intent)
    .input('userId', sql.Int, intent.userId)
    .input('branchId', sql.Int, intent.branchId)
    .input('fingerprint', sql.VarChar(64), intent.fingerprint)
    .query(`
      INSERT INTO dbo.TblPosSaleRequest
        (TenantId, RequestID, UserID, BranchID, PayloadHash, Status)
      VALUES (@tenantId, @requestId, @userId, @branchId, @fingerprint, N'PENDING');
    `);
  if (created.rowsAffected?.[0] !== 1) {
    throw new SaleIdempotencyError('IDEMPOTENCY_INCONSISTENT',
      'تعذر حجز رقم طلب الفاتورة', 409);
  }
  return { kind: 'new', intent };
}

/** Must execute after paid invoice+rewards are saved but BEFORE COMMIT. */
export async function completeSaleRequest(
  tx: Transaction,
  reservation: SaleReservation | null,
  invoice: { invID: number; invType: string },
): Promise<void> {
  if (!reservation || reservation.kind !== 'new') return;
  if (!Number.isSafeInteger(invoice.invID) || invoice.invID <= 0 || invoice.invType !== 'مبيعات') {
    throw new SaleIdempotencyError('IDEMPOTENCY_INCONSISTENT',
      'الفاتورة لم تكتمل فلا يمكن اعتماد طلبها', 409);
  }
  const r = await request(tx, reservation.intent)
    .input('fingerprint', sql.VarChar(64), reservation.intent.fingerprint)
    .input('invId', sql.Int, invoice.invID)
    .query(`
      UPDATE dbo.TblPosSaleRequest
      SET Status = N'COMMITTED', InvID = @invId, InvType = N'مبيعات',
          CompletedAtUtc = SYSUTCDATETIME()
      WHERE TenantId = @tenantId AND RequestID = @requestId
        AND PayloadHash = @fingerprint AND Status = N'PENDING'
        AND InvID IS NULL AND InvType IS NULL;
    `);
  if (r.rowsAffected?.[0] !== 1) {
    throw new SaleIdempotencyError('IDEMPOTENCY_INCONSISTENT',
      'حالة طلب حفظ الفاتورة تغيّرت؛ العملية هترجع بدون حفظ', 409);
  }
}
