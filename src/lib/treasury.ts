import type { TreasuryMovement } from '@/lib/types/treasury';

/**
 * Resolve the Arabic operation-type label for a treasury movement.
 *
 * Rules:
 * 1. Trust the stored invType when it is a known, non-corrupted value.
 * 2. For transfers (Notes contains "تحويل" or invType is corrupted/unknown),
 *    derive the label from the canonical inOut direction:
 *      - 'out' → مصروفات
 *      - 'in'  → إيرادات
 * 3. Fall back to the raw invType if nothing else matches.
 */
export function getMovementTypeLabel(movement: TreasuryMovement): string {
  const raw = (movement.invType ?? '').trim();
  const isKnown = ['مصروفات', 'ايرادات', 'إيرادات', 'مبيعات', 'مرتجع', 'إرجاع'].includes(raw);
  const isTransfer = !isKnown || (movement.notes ?? '').includes('تحويل');

  if (isTransfer) {
    return movement.inOut === 'in' ? 'إيرادات' : 'مصروفات';
  }

  return raw === 'ايرادات' ? 'إيرادات' : raw;
}

/**
 * Normalized, searchable representation of the movement type.
 * Used by client-side filters so that "إيرادات" / "ايرادات" searches work.
 */
export function getMovementTypeSearchText(movement: TreasuryMovement): string {
  const label = getMovementTypeLabel(movement);
  return `${label} ${movement.invType ?? ''}`.trim().toLowerCase();
}
