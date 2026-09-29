import 'server-only';
import type { Transaction } from 'mssql';
import type { TreasuryWritePorts } from '@/lib/treasuryComposition';
import { reverseMoneyMovementByCashMoveId } from '../internal/reverseMovement';
import { deleteLedgerEntriesLinkedToCashMove } from '@/lib/services/cashMoveHardDeleteService';

export async function reverseTreasuryOwnedMovement(
  tx: Transaction,
  ports: TreasuryWritePorts,
  input: {
    cashMoveId: number;
    idempotencyKey: string;
    reason?: string;
    cleanupLedger?: boolean;
  },
): Promise<number> {
  const reversalId = await reverseMoneyMovementByCashMoveId(tx, ports.actor, {
    tenantId: ports.tenantId,
    cashMoveId: input.cashMoveId,
    idempotencyKey: input.idempotencyKey,
    reason: input.reason ?? 'delete',
  });

  if (input.cleanupLedger !== false) {
    await deleteLedgerEntriesLinkedToCashMove(tx, input.cashMoveId);
  }

  return reversalId;
}
