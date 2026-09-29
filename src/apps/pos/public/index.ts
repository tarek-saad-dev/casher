/** DRVO-003 POS app boundary — public exports for routes and legacy re-exports. */
export const APP_CODE = 'pos' as const;

export { isPosPortEnabled } from '../internal/posPortFlag';

export {
  createSale,
  type CreateSaleInput,
  type CreateSaleResult,
} from '../application/createSale';

export {
  updateSale,
  type UpdateInvoiceInput,
  type UpdateInvoiceResult,
} from '../application/updateSale';

export { deleteSale } from '../application/deleteSale';

export {
  getSaleSnapshot,
  type InvoiceSnapshot,
} from '../application/getSaleSnapshot';

export type {
  InvoiceItemInput,
  InvoicePaymentAllocationInput,
  InvoiceHeaderSnapshot,
  InvoiceDetailSnapshot,
  InvoicePaymentSnapshot,
  InvoiceCashMoveSnapshot,
  UpdateInvoiceInput as SaleUpdateInput,
  InvoiceSnapshot as SaleSnapshot,
} from './sales';
