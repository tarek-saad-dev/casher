/**
 * Phase 1J — product stock-tracking classification.
 * Proven rule from live last132: CatType='pro' OR ProType='pro' (case-insensitive).
 * No TrackStock column — classification is reliable for current catalog.
 */
export type ProductTrackingFlags = {
  proId: number;
  proType: string | null;
  catType: string | null;
};

export function isStockTrackedProduct(flags: ProductTrackingFlags): boolean {
  const cat = String(flags.catType || '').trim().toLowerCase();
  const pt = String(flags.proType || '').trim().toLowerCase();
  return cat === 'pro' || pt === 'pro' || pt === 'product';
}

/**
 * Continuity default: GLEEM already sells tracked products with TblPro.Qty null/0
 * and no stock checks. Until operators receive/adjust stock and flip the flag,
 * negative (or unconstrained) stock is allowed when env is unset/true.
 * Set INVENTORY_ALLOW_NEGATIVE_STOCK=false to enforce non-negative.
 */
export function allowNegativeStock(): boolean {
  const v = (process.env.INVENTORY_ALLOW_NEGATIVE_STOCK || '').trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'no') return false;
  if (v === '1' || v === 'true' || v === 'yes') return true;
  return true;
}

export const INVENTORY_MOVEMENT_TYPES = [
  'OPENING_BALANCE',
  'SALE',
  'SALE_REVERSAL',
  'PURCHASE_RECEIPT',
  'PURCHASE_RETURN',
  'MANUAL_ADJUSTMENT_IN',
  'MANUAL_ADJUSTMENT_OUT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'STOCK_COUNT_ADJUSTMENT',
  'LEGACY_IMPORT',
] as const;

export type InventoryMovementType = (typeof INVENTORY_MOVEMENT_TYPES)[number];
