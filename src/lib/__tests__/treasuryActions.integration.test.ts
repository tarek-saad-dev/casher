import { describe, it, expect, beforeAll } from 'vitest';
import { getPool, sql } from '@/lib/db';
import { executeTreasuryTransfer, closeTreasuryDay } from '@/lib/actions/treasuryActions';

let dbAvailable = false;
let dbReason = '';

beforeAll(async () => {
  try {
    const pool = await getPool();
    await pool.request().query('SELECT 1 AS ok');
    dbAvailable = true;
  } catch (e: unknown) {
    dbAvailable = false;
    dbReason = e instanceof Error ? e.message : 'DB connection failed';
  }
});

const itIfDb = (name: string, fn: () => Promise<void>) => {
  it(name, async () => {
    if (!dbAvailable) {
      console.warn(`Skipping DB test: ${dbReason}`);
      return;
    }
    await fn();
  });
};

describe('treasuryActions integration', () => {
  itIfDb('creates exactly one outgoing and one incoming cash move per transfer', async () => {
    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

    try {
      // Find two payment methods
      const pmResult = await new sql.Request(transaction).query(
        `SELECT TOP 2 PaymentID FROM dbo.TblPaymentMethods ORDER BY PaymentID`
      );
      if (pmResult.recordset.length < 2) {
        throw new Error('Need at least 2 payment methods to test transfer');
      }
      const [fromPm, toPm] = pmResult.recordset;
      const amount = 123.45;

      const transferResult = await executeTreasuryTransfer(transaction, {
        amount,
        fromPaymentMethodId: fromPm.PaymentID,
        toPaymentMethodId: toPm.PaymentID,
        notes: 'integration test transfer',
        transferDate: '2025-01-01',
        userId: 1,
      });

      expect(transferResult.expenseId).toBeGreaterThan(0);
      expect(transferResult.incomeId).toBeGreaterThan(0);
      expect(transferResult.expenseId).not.toBe(transferResult.incomeId);
      expect(transferResult.amount).toBe(amount);

      // Verify exactly one outgoing and one incoming record
      const cashMoves = await new sql.Request(transaction)
        .input('expenseId', sql.Int, transferResult.expenseId)
        .input('incomeId', sql.Int, transferResult.incomeId)
        .query(`
          SELECT ID, inOut, GrandTolal, PaymentMethodID FROM dbo.TblCashMove
          WHERE ID IN (@expenseId, @incomeId)
        `);
      expect(cashMoves.recordset).toHaveLength(2);
      const outMove = cashMoves.recordset.find((m) => m.inOut === 'out');
      const inMove = cashMoves.recordset.find((m) => m.inOut === 'in');
      expect(outMove).toBeDefined();
      expect(inMove).toBeDefined();
      expect(outMove.GrandTolal).toBe(amount);
      expect(inMove.GrandTolal).toBe(amount);
      expect(outMove.PaymentMethodID).toBe(fromPm.PaymentID);
      expect(inMove.PaymentMethodID).toBe(toPm.PaymentID);

      // No extra records should exist for this transfer's invIDs
      const extra = await new sql.Request(transaction)
        .input('expenseInvID', sql.Int, transferResult.expenseInvID)
        .input('incomeInvID', sql.Int, transferResult.incomeInvID)
        .query(`
          SELECT COUNT(*) AS cnt FROM dbo.TblCashMove
          WHERE (invID = @expenseInvID AND invType = N'مصروفات')
             OR (invID = @incomeInvID AND invType = N'ايرادات')
        `);
      expect(extra.recordset[0].cnt).toBe(2);
    } finally {
      await transaction.rollback();
    }
  });

  itIfDb('close day does not duplicate reconciliation rows', async () => {
    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    try {
      // Find or create an open day
      const dayResult = await new sql.Request(transaction).query(
        `SELECT TOP 1 ID, NewDay FROM dbo.TblNewDay WHERE Status = 1 ORDER BY ID DESC`
      );
      if (dayResult.recordset.length === 0) {
        throw new Error('No open business day found for close-day test');
      }
      const dayId = dayResult.recordset[0].ID;
      const newDay = dayResult.recordset[0].NewDay;
      const newDayDate = newDay instanceof Date
        ? newDay.toISOString().split('T')[0]
        : String(newDay);

      const firstClose = await closeTreasuryDay(transaction, {
        newDay: newDayDate,
        reconciliations: [
          { paymentMethodId: 1, systemAmount: 1000, countedAmount: 1000, notes: 'first' },
        ],
        closedByUserId: 1,
      });
      expect(firstClose.reconciliationIds).toHaveLength(1);

      // Second close of the same day should fail
      await expect(
        closeTreasuryDay(transaction, {
          newDay: newDayDate,
          reconciliations: [
            { paymentMethodId: 1, systemAmount: 1000, countedAmount: 1000, notes: 'second' },
          ],
          closedByUserId: 1,
        })
      ).rejects.toThrow('تم تقفيل هذا اليوم مسبقاً');

      // Verify only one reconciliation row exists (TblTreasuryCloseRecon.NewDay is the day ID)
      const reconCount = await new sql.Request(transaction)
        .input('dayId', sql.Int, dayId)
        .query(`SELECT COUNT(*) AS cnt FROM dbo.TblTreasuryCloseRecon WHERE NewDay = @dayId`);
      expect(reconCount.recordset[0].cnt).toBe(1);
    } finally {
      await transaction.rollback();
    }
  });
});
