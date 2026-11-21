/**
 * Server-side referral checkout input/pricing contract.
 * The API remains locked unless POS_REFERRAL_CHECKOUT_ENABLED=true.
 * No customer/client eligibility is established by this pure module:
 * database facts must be rechecked under locks in the sale transaction.
 */
import {
  computeInvoiceItemsTotals,
  type InvoiceItemsTotals,
  type InvoiceItemForTotals,
} from '@/lib/sales/service-line-totals';

export const REFERRAL_CHECKOUT_PERCENT = 50 as const;
export const REFERRAL_REFERRER_VOUCHER_PERCENT = 20 as const;

export class ReferralCheckoutError extends Error {
  constructor(
    readonly code:
      | 'REFERRALS_DISABLED'
      | 'INVALID_REFERRAL_CODE'
      | 'REFERRAL_CLIENT_REQUIRED'
      | 'REFERRAL_DISCOUNT_CONFLICT'
      | 'REFERRAL_INVALID_ITEMS'
      | 'REFERRAL_NOT_ELIGIBLE'
      | 'REFERRAL_INVOICE_NOT_PAID'
      | 'REFERRAL_SCHEMA_UNAVAILABLE',
    message: string,
    readonly status = 409,
  ) {
    super(message);
    this.name = 'ReferralCheckoutError';
  }
}

export function referralCheckoutEnabled(): boolean {
  return process.env.POS_REFERRAL_CHECKOUT_ENABLED === 'true';
}

export function parseReferralCheckoutRequest(
  raw: unknown,
  clientId: unknown,
  enabled = referralCheckoutEnabled(),
): string | null {
  if (raw === undefined || raw === null) return null;
  // Explicit attempts are rejected rather than silently charging the original price.
  if (!enabled) {
    throw new ReferralCheckoutError('REFERRALS_DISABLED', 'خصم الإحالة غير متاح حاليًا');
  }
  if (typeof raw !== 'string') {
    throw new ReferralCheckoutError('INVALID_REFERRAL_CODE', 'كود إحالة غير صالح', 400);
  }
  const code = raw.trim().toUpperCase();
  if (!/^CUT-[0-9A-F]{24}$/.test(code)) {
    throw new ReferralCheckoutError('INVALID_REFERRAL_CODE', 'كود إحالة غير صالح', 400);
  }
  if (!Number.isSafeInteger(clientId) || Number(clientId) < 1 || Number(clientId) > 2_147_483_647) {
    throw new ReferralCheckoutError('REFERRAL_CLIENT_REQUIRED', 'اختار العميل قبل استخدام كود الإحالة', 400);
  }
  return code;
}

/**
 * The first-visit promotion is exclusive: manual header and line discounts
 * cannot be stacked. The calculation is made by the same invoice-total helper
 * used to persist both sale writer variants (not from the browser total).
 */
export function priceFirstVisitReferral(
  items: InvoiceItemForTotals[],
  currentHeader: { discountPercent?: number | null; discountValue?: number | null },
): InvoiceItemsTotals {
  if (!Array.isArray(items) || items.length === 0 ||
      items.some(item => !Number.isFinite(item.sPrice) || item.sPrice < 0 ||
        !Number.isFinite(item.qty) || item.qty <= 0 ||
        !Number.isFinite(Number(item.discountValue ?? 0)) ||
        !Number.isFinite(Number(item.discountPercent ?? 0)))) {
    throw new ReferralCheckoutError('REFERRAL_INVALID_ITEMS', 'قيمة خدمات الإحالة غير صالحة', 400);
  }
  if (Number(currentHeader.discountPercent ?? 0) !== 0 ||
      Number(currentHeader.discountValue ?? 0) !== 0 ||
      items.some(item => Number(item.discountValue ?? 0) !== 0 ||
        Number(item.discountPercent ?? 0) !== 0)) {
    throw new ReferralCheckoutError(
      'REFERRAL_DISCOUNT_CONFLICT',
      'خصم الإحالة لا يمكن جمعه مع خصومات أخرى',
      409,
    );
  }
  const computed = computeInvoiceItemsTotals(items, {
    discountPercent: REFERRAL_CHECKOUT_PERCENT,
  });
  if (computed.linesNetTotal <= 0 || computed.grandTotal <= 0) {
    throw new ReferralCheckoutError('REFERRAL_INVALID_ITEMS', 'لا يمكن تطبيق خصم الإحالة على فاتورة بقيمة صفر', 400);
  }
  return computed;
}

/** Token-safe identity: public code never contains client IDs or phone numbers. */
export function generatePermanentReferralCheckoutCode(randomBytes: (size: number) => Buffer): string {
  return 'CUT-' + randomBytes(12).toString('hex').toUpperCase();
}
