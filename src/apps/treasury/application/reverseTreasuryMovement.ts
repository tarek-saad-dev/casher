import 'server-only';
import type { Transaction } from 'mssql';
import type { TreasuryWritePorts } from '@/lib/treasuryComposition';
import { sql } from '@/lib/db';
import { reverseMoneyMovementByCashMoveId } from '../internal/reverseMovement';

export type ReverseTreasuryOwnedResult = {
  reversalCashMoveId: number;
  ledgerVoidedCount: number;
};

/**
 * Void linked employee-ledger rows instead of deleting them.
 * Reports already ignore IsVoided = 1, so the ledger effect matches a delete
 * while the original entry stays traceable next to the cash row.
 */
async function voidLedgerEntriesLinkedToCashMove(
  tx: Transaction,
  cashMoveId: number,
): Promise<number> {
  const result = await new sql.Request(tx)
    .input('cashMoveId', sql.Int, cashMoveId)
    .query(`
      UPDATE dbo.TblEmpLedgerEntry
      SET IsVoided = 1,
          VoidReason = N'treasury.movement.reversed',
          UpdatedAt = SYSDATETIME()
      WHERE CashMoveID = @cashMoveId
        AND ISNULL(IsVoided, 0) = 0
    `);
  return Number(result.rowsAffected?.[0] ?? 0);
}

export async function reverseTreasuryOwnedMovement(
  tx: Transaction,
  ports: TreasuryWritePorts,
  input: {
    cashMoveId: number;
    idempotencyKey: string;
    reason?: string;
    cleanupLedger?: boolean;
  },
): Promise<ReverseTreasuryOwnedResult> {
  const reversalCashMoveId = await reverseMoneyMovementByCashMoveId(tx, ports.actor, {
    tenantId: ports.tenantId,
    cashMoveId: input.cashMoveId,
    idempotencyKey: input.idempotencyKey,
    reason: input.reason ?? 'delete',
  });

  const ledgerVoidedCount = input.cleanupLedger === false
    ? 0
    : await voidLedgerEntriesLinkedToCashMove(tx, input.cashMoveId);

  return { reversalCashMoveId, ledgerVoidedCount };
}
