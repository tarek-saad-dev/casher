/** Sale invoice types and repository operations — POS public surface. */
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
} from '../internal/legacySaleRepository';

export {
  getInvoiceSnapshot,
  updateInvoice,
  deleteInvoice,
} from '../internal/legacySaleRepository';

export {
  createSale,
  type CreateSaleInput,
  type CreateSaleResult,
} from '../application/createSale';

export { updateSale } from '../application/updateSale';
export { deleteSale } from '../application/deleteSale';
export { getSaleSnapshot } from '../application/getSaleSnapshot';

export { isPosPortEnabled } from '../internal/posPortFlag';
