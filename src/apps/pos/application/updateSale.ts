import 'server-only';
import type { Transaction } from 'mssql';
import {
  buildPosPortsForStaffUser,
} from '@/lib/posComposition';
import {
  buildSaleCashMoveReplacer,
} from '@/lib/posSaleTreasuryComposition';
import {
  updateInvoice,
  type UpdateInvoiceInput,
  type UpdateInvoiceResult,
} from '../internal/legacySaleRepository';
import { isPosSaleTreasuryMutationEnabled } from '../internal/posSaleTreasuryMutationFlag';

export type { UpdateInvoiceInput, UpdateInvoiceResult };

export async function updateSale(
  transaction: Transaction,
  invID: number,
  input: UpdateInvoiceInput,
  userID: number,
): Promise<UpdateInvoiceResult> {
  let treasuryMutation = null;
  if (isPosSaleTreasuryMutationEnabled()) {
    const ports = await buildPosPortsForStaffUser(userID);
    treasuryMutation = {
      replaceSaleCashMove: buildSaleCashMoveReplacer(ports.tenantId, ports.actor),
    };
  }

  return updateInvoice(transaction, invID, input, userID, treasuryMutation);
}
