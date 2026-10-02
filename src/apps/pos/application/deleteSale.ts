import 'server-only';
import type { Transaction } from 'mssql';
import {
  buildPosPortsForStaffUser,
} from '@/lib/posComposition';
import {
  buildSaleCashMoveRemover,
} from '@/lib/posSaleTreasuryComposition';
import { deleteInvoice } from '../internal/legacySaleRepository';
import { isPosSaleTreasuryMutationEnabled } from '../internal/posSaleTreasuryMutationFlag';

export async function deleteSale(
  transaction: Transaction,
  invID: number,
  activeBranchId: number,
  userID: number,
): Promise<void> {
  let treasuryMutation = null;
  if (isPosSaleTreasuryMutationEnabled()) {
    const ports = await buildPosPortsForStaffUser(userID);
    treasuryMutation = {
      removeSaleCashMove: buildSaleCashMoveRemover(ports.tenantId, ports.actor),
    };
  }

  return deleteInvoice(transaction, invID, activeBranchId, treasuryMutation);
}
