/** Client-safe Arabic labels for TblInventoryMovement.MovementType (no server imports). */
export const MOVEMENT_TYPE_LABEL: Record<string, string> = {
  OPENING_BALANCE: 'رصيد افتتاحي',
  SALE: 'بيع',
  SALE_REVERSAL: 'عكس بيع',
  PURCHASE_RECEIPT: 'استلام مشتريات',
  PURCHASE_RETURN: 'مرتجع مشتريات',
  MANUAL_ADJUSTMENT_IN: 'تسوية بالزيادة',
  MANUAL_ADJUSTMENT_OUT: 'تسوية بالنقص',
  TRANSFER_OUT: 'تحويل صادر',
  TRANSFER_IN: 'تحويل وارد',
  STOCK_COUNT_ADJUSTMENT: 'تسوية جرد',
  LEGACY_IMPORT: 'استيراد قديم',
};

export function movementTypeLabel(type: string | null | undefined): string {
  if (!type) return '—';
  return MOVEMENT_TYPE_LABEL[type] ?? type;
}
