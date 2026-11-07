import 'server-only';
import { getPool, sql } from '@/lib/db';
import { InventoryDomainError } from './inventoryMutation.service';

export type InventoryStockPolicy = {
  tenantId: string;
  allowNegativeStock: boolean;
  openingStockRegistered: boolean;
  negativeBalancesReconciled: boolean;
  strictModeActivatedAt: string | null;
  updatedAt: string | null;
  notes: string | null;
};

type Tx = sql.Transaction;

async function ensurePolicyRow(
  executor: { request: () => sql.Request } | Tx,
  tenantId: string,
): Promise<void> {
  const req =
    'request' in executor && typeof executor.request === 'function'
      ? executor.request()
      : new sql.Request(executor as Tx);
  await req.input('tenantId', sql.UniqueIdentifier, tenantId).query(`
    IF NOT EXISTS (
      SELECT 1 FROM dbo.TblInventoryStockPolicy WHERE TenantId = @tenantId
    )
    BEGIN
      INSERT INTO dbo.TblInventoryStockPolicy (TenantId, AllowNegativeStock)
      VALUES (@tenantId, 1);
    END
  `);
}

export async function getInventoryStockPolicy(
  tenantId: string,
): Promise<InventoryStockPolicy> {
  const db = await getPool();
  await ensurePolicyRow(db, tenantId);
  const result = await db
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      SELECT
        TenantId, AllowNegativeStock, OpeningStockRegistered,
        NegativeBalancesReconciled, StrictModeActivatedAt, UpdatedAt, Notes
      FROM dbo.TblInventoryStockPolicy
      WHERE TenantId = @tenantId
    `);
  const row = result.recordset[0];
  return {
    tenantId: String(row.TenantId),
    allowNegativeStock: Boolean(row.AllowNegativeStock),
    openingStockRegistered: Boolean(row.OpeningStockRegistered),
    negativeBalancesReconciled: Boolean(row.NegativeBalancesReconciled),
    strictModeActivatedAt: row.StrictModeActivatedAt
      ? new Date(row.StrictModeActivatedAt).toISOString()
      : null,
    updatedAt: row.UpdatedAt ? new Date(row.UpdatedAt).toISOString() : null,
    notes: row.Notes == null ? null : String(row.Notes),
  };
}

/**
 * Sale/POS negative-stock gate.
 * Precedence: tenant policy row (when present) > env INVENTORY_ALLOW_NEGATIVE_STOCK > default true.
 * Continuity: until strict mode is activated, sales remain unconstrained.
 */
export async function allowNegativeStockForTenant(tenantId: string | null | undefined): Promise<boolean> {
  if (!tenantId) {
    const v = (process.env.INVENTORY_ALLOW_NEGATIVE_STOCK || '').trim().toLowerCase();
    if (v === '0' || v === 'false' || v === 'no') return false;
    return true;
  }
  try {
    const policy = await getInventoryStockPolicy(tenantId);
    return policy.allowNegativeStock;
  } catch {
    const v = (process.env.INVENTORY_ALLOW_NEGATIVE_STOCK || '').trim().toLowerCase();
    if (v === '0' || v === 'false' || v === 'no') return false;
    return true;
  }
}

export async function listNegativeBalances(tenantId: string): Promise<
  Array<{ branchId: number; branchName: string; proId: number; productName: string; qtyOnHand: number }>
> {
  const db = await getPool();
  const result = await db
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      SELECT
        bi.BranchID AS branchId,
        b.BranchName AS branchName,
        bi.ProID AS proId,
        ISNULL(p.ProNameAr, p.ProName) AS productName,
        bi.QtyOnHand AS qtyOnHand
      FROM dbo.TblBranchInventory bi
      INNER JOIN dbo.TblBranch b ON b.BranchID = bi.BranchID
      INNER JOIN dbo.TblPro p ON p.ProID = bi.ProID AND p.TenantId = @tenantId
      WHERE bi.QtyOnHand < 0
      ORDER BY bi.QtyOnHand ASC, bi.ProID
    `);
  return result.recordset.map((r: Record<string, unknown>) => ({
    branchId: Number(r.branchId),
    branchName: String(r.branchName ?? ''),
    proId: Number(r.proId),
    productName: String(r.productName ?? ''),
    qtyOnHand: Number(r.qtyOnHand),
  }));
}

export async function updateInventoryStockPolicy(args: {
  tenantId: string;
  userId: number;
  openingStockRegistered?: boolean;
  negativeBalancesReconciled?: boolean;
  activateStrictMode?: boolean;
  allowNegativeStock?: boolean;
  notes?: string | null;
}): Promise<InventoryStockPolicy> {
  const db = await getPool();
  await ensurePolicyRow(db, args.tenantId);
  const current = await getInventoryStockPolicy(args.tenantId);

  let allowNeg = current.allowNegativeStock;
  let opening = current.openingStockRegistered;
  let reconciled = current.negativeBalancesReconciled;
  let strictAt: Date | null = current.strictModeActivatedAt
    ? new Date(current.strictModeActivatedAt)
    : null;

  if (args.openingStockRegistered != null) opening = Boolean(args.openingStockRegistered);
  if (args.negativeBalancesReconciled != null) {
    reconciled = Boolean(args.negativeBalancesReconciled);
  }
  if (args.allowNegativeStock != null && args.activateStrictMode !== true) {
    allowNeg = Boolean(args.allowNegativeStock);
  }

  if (args.activateStrictMode) {
    if (!opening) {
      throw new InventoryDomainError(
        'OPENING_REQUIRED',
        'يجب تسجيل المخزون الافتتاحي قبل تفعيل منع الرصيد السالب',
        409,
      );
    }
    const negatives = await listNegativeBalances(args.tenantId);
    if (negatives.length > 0 && !reconciled) {
      throw new InventoryDomainError(
        'RECONCILE_REQUIRED',
        `يوجد ${negatives.length} رصيد سالب — أكمل التسوية قبل التفعيل`,
        409,
      );
    }
    if (negatives.length > 0) {
      throw new InventoryDomainError(
        'NEGATIVE_REMAINING',
        'لا يمكن تفعيل الوضع الصارم مع أرصدة سالبة متبقية',
        409,
      );
    }
    allowNeg = false;
    reconciled = true;
    strictAt = new Date();
  }

  await db
    .request()
    .input('tenantId', sql.UniqueIdentifier, args.tenantId)
    .input('allowNeg', sql.Bit, allowNeg ? 1 : 0)
    .input('opening', sql.Bit, opening ? 1 : 0)
    .input('reconciled', sql.Bit, reconciled ? 1 : 0)
    .input('strictAt', sql.DateTime2, strictAt)
    .input('userId', sql.Int, args.userId)
    .input('notes', sql.NVarChar(400), args.notes ?? null)
    .query(`
      UPDATE dbo.TblInventoryStockPolicy
      SET AllowNegativeStock = @allowNeg,
          OpeningStockRegistered = @opening,
          NegativeBalancesReconciled = @reconciled,
          StrictModeActivatedAt = @strictAt,
          UpdatedAt = SYSUTCDATETIME(),
          UpdatedByUserID = @userId,
          Notes = COALESCE(@notes, Notes)
      WHERE TenantId = @tenantId
    `);

  return getInventoryStockPolicy(args.tenantId);
}
