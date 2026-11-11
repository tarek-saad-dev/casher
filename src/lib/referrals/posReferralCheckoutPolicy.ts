/**
 * Browser-side referral checkout affordances.
 * All eligibility and money rules are revalidated by the sale transaction;
 * client-side preview approval can become stale and is never authoritative.
 */
import type { CartItem, SaleState } from '@/lib/types';
import { normalizePosReferralCode } from './posReferralPreview';

export const POS_REFERRAL_CHECKOUT_UI_ENABLED =
  process.env.NEXT_PUBLIC_POS_REFERRAL_CHECKOUT_ENABLED === 'true';

type ReferralState = Pick<SaleState,
  'customer' | 'items' | 'discountPercent' | 'discountValue' | 'referralCode'>;

export function canApplyPosReferral(state: ReferralState, code: string, clientId: number): boolean {
  const normalized = normalizePosReferralCode(code);
  if (!normalized || !state.customer || state.customer.ClientID !== clientId || state.referralCode) {
    return false;
  }
  if (state.items.length === 0 || state.items.length > 100 ||
      Number(state.discountPercent) !== 0 || Number(state.discountValue) !== 0) {
    return false;
  }
  return state.items.every((line: CartItem) =>
    Number.isSafeInteger(line.ProID) && line.ProID > 0 &&
    Number.isSafeInteger(line.Qty) && line.Qty > 0 &&
    Number.isFinite(line.SPrice) && line.SPrice > 0 &&
    Number.isFinite(line.Bonus) && line.Bonus >= 0 &&
    Number(line.Dis) === 0 && Number(line.DisVal) === 0
  );
}

export function referralCheckoutLineItemsFingerprint(items: CartItem[]): string {
  // Only metadata that changes the total or service eligibility matters.
  // This helper is diagnostic; reducer invalidates on ANY line edit.
  return JSON.stringify(items.map(item => [
    item.id, item.ProID, item.SPrice, item.Bonus, item.Qty, item.Dis, item.DisVal,
  ]));
}

export function referralSalePayloadDiscount(
  state: Pick<SaleState, 'referralCode' | 'discountPercent' | 'discountValue'>,
): { dis: number; disVal: number; referralCode?: string } {
  if (!state.referralCode) {
    return { dis: state.discountPercent, disVal: state.discountValue };
  }
  const code = normalizePosReferralCode(state.referralCode);
  if (!code || state.discountPercent !== 50 || !(state.discountValue > 0)) {
    throw new Error('REFERRAL_CHECKOUT_INCONSISTENT');
  }
  // Exclusive 50% referral discount is computed by authoritative POST /api/sales.
  // A nonzero manual header discount sent alongside code would be rejected.
  return { dis: 0, disVal: 0, referralCode: code };
}
