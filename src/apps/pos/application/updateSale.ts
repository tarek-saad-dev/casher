import 'server-only';
import type { Transaction } from 'mssql';
import {
  updateInvoice,
  type UpdateInvoiceInput,
  type UpdateInvoiceResult,
} from '../internal/legacySaleRepository';

export type { UpdateInvoiceInput, UpdateInvoiceResult };

export async function updateSale(
  transaction: Transaction,
  invID: number,
  input: UpdateInvoiceInput,
  userID: number,
): Promise<UpdateInvoiceResult> {
  return updateInvoice(transaction, invID, input, userID);
}
