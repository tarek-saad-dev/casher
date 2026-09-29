import 'server-only';

import { getPool, sql } from '@/lib/db';
import {
  executeLegacySaleCreateTransaction,
  type LegacySaleCreateTransactionInput,
} from '../internal/legacySaleCreateAdapter';
import { runSalePostCommitEffects } from '../internal/salePostCommitEffects';

export type CreateSaleInput = LegacySaleCreateTransactionInput & {
  branchName: string;
};

export type CreateSaleResult = {
  invID: number;
  invType: string;
};

export async function createSale(input: CreateSaleInput): Promise<CreateSaleResult> {
  const db = await getPool();
  const transaction = new sql.Transaction(db);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  console.log(`[pos-api]   Transaction started (SERIALIZABLE)`);

  const { branchName, ...txInput } = input;

  try {
    const { invID, invType, targetRecalcScopes } = await executeLegacySaleCreateTransaction(
      transaction,
      txInput,
    );

    await transaction.commit();
    console.log(
      `[pos-api]   ✅ COMMITTED — invID=${invID}, invType=${invType}`,
    );
    console.log(`[pos-api] ──── SAVE SALE COMPLETE ────`);

    runSalePostCommitEffects({
      invID,
      invType,
      clientId: input.clientId,
      userID: input.userID,
      grandTotal: input.computed.grandTotal,
      isSplitPayment: input.isSplitPayment,
      headerPaymentMethodId: input.headerPaymentMethodId,
      activeAllocations: input.activeAllocations,
      branchId: input.branchId,
      branchName,
      targetRecalcScopes,
    });

    return { invID, invType };
  } catch (err) {
    const rollbackReason = err instanceof Error ? err.message : String(err);
    console.error(`[pos-api]   ❌ ROLLING BACK — reason: ${rollbackReason}`);
    try {
      await transaction.rollback();
      console.log(`[pos-api]   Rollback successful`);
    } catch (rbErr) {
      console.error(
        `[pos-api]   Rollback also failed: ${rbErr instanceof Error ? rbErr.message : rbErr}`,
      );
    }
    throw err;
  }
}
