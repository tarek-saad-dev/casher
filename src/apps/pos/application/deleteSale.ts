import 'server-only';
import type { Transaction } from 'mssql';
import { deleteInvoice } from '../internal/legacySaleRepository';

export async function deleteSale(
  transaction: Transaction,
  invID: number,
  activeBranchId: number,
): Promise<void> {
  return deleteInvoice(transaction, invID, activeBranchId);
}
