import { sql } from "@/lib/db";
import type { Transaction } from "mssql";

export const CLEARING_METHOD_NAME = "دفع متعدد - حساب تسوية";
export const SPLIT_EXPENSE_CAT_NAME = "تحويل بين طرق الدفع - مصروف";
export const SPLIT_INCOME_CAT_NAME = "تحويل بين طرق الدفع - إيراد";

// TblSettingValues keys (all <= 50 chars, matching the migration)
const KEY_CLEARING = "SplitClearingMethodID";
const KEY_EXPENSE  = "SplitExpenseCatID";
const KEY_INCOME   = "SplitIncomeCatID";

export interface SplitPaymentConfig {
  clearingMethodId: number;
  expenseCatId: number;
  incomeCatId: number;
}

/**
 * Resolve the split-payment clearing configuration from TblSettingValues.
 * TblSettingValues schema: ID (int PK), Name (nvarchar 50), Value (decimal 10,2)
 * Accepts either a pool or an active transaction so it can run inside a tx.
 * Throws if the migration has not been run.
 */
export async function resolveSplitPaymentConfig(
  pool: import("mssql").ConnectionPool | Transaction,
): Promise<SplitPaymentConfig> {
  const req = new sql.Request(pool as any);
  const result = await req.query(`
    SELECT Name, CAST(Value AS INT) AS IntValue
    FROM [dbo].[TblSettingValues]
    WHERE Name IN (
      N'${KEY_CLEARING}',
      N'${KEY_EXPENSE}',
      N'${KEY_INCOME}'
    )
  `);

  const map: Record<string, number> = {};
  for (const row of result.recordset) {
    if (row.IntValue > 0) {
      map[row.Name] = row.IntValue;
    }
  }

  const clearingMethodId = map[KEY_CLEARING];
  const expenseCatId     = map[KEY_EXPENSE];
  const incomeCatId      = map[KEY_INCOME];

  if (!clearingMethodId || !expenseCatId || !incomeCatId) {
    throw new Error(
      "Split payment configuration not found. Run db/migrations/add-split-payment-clearing.sql first.",
    );
  }

  return { clearingMethodId, expenseCatId, incomeCatId };
}

/**
 * Returns the clearing PaymentID directly from TblPaymentMethods by exact name.
 * Used as a fallback when TblSettingValues is unavailable.
 */
export async function getClearingMethodId(
  pool: import("mssql").ConnectionPool,
): Promise<number | null> {
  const result = await pool
    .request()
    .input("name", sql.NVarChar(200), CLEARING_METHOD_NAME)
    .query(
      `SELECT PaymentID FROM [dbo].[TblPaymentMethods] WHERE PaymentMethod = @name`,
    );
  return result.recordset.length > 0 ? result.recordset[0].PaymentID : null;
}
