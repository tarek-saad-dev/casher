import 'server-only';
import type { Transaction } from 'mssql';
import {
  getInvoiceSnapshot,
  type InvoiceSnapshot,
} from '../internal/legacySaleRepository';

export type { InvoiceSnapshot };

export async function getSaleSnapshot(
  transaction: Transaction,
  invID: number,
): Promise<InvoiceSnapshot | null> {
  return getInvoiceSnapshot(transaction, invID);
}
