/**
 * Invoice (sales) domain actions — backward-compatible re-exports from POS app.
 */

export type {
  InvoiceItemInput,
  InvoicePaymentAllocationInput,
  UpdateInvoiceInput,
  InvoiceHeaderSnapshot,
  InvoiceDetailSnapshot,
  InvoicePaymentSnapshot,
  InvoiceCashMoveSnapshot,
  InvoiceSnapshot,
  UpdateInvoiceResult,
} from '@/apps/pos/public/sales';

export {
  getInvoiceSnapshot,
  updateInvoice,
  deleteInvoice,
} from '@/apps/pos/public/sales';
