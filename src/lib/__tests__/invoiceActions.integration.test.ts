import { describe, it, expect, beforeAll } from 'vitest';
import { getPool, sql } from '@/lib/db';
import { getInvoiceSnapshot, updateInvoice, deleteInvoice } from '@/lib/actions/invoiceActions';

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

describe('invoiceActions integration', () => {
  itIfDb('updateInvoice mutates header, details, and payments exactly once', async () => {
    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    try {
      // Find an existing invoice
      const headResult = await new sql.Request(transaction).query(
        `SELECT TOP 1 invID FROM dbo.TblinvServHead WHERE invType = N'مبيعات' ORDER BY invID DESC`
      );
      if (headResult.recordset.length === 0) {
        throw new Error('No sales invoice found for test');
      }
      const invID = headResult.recordset[0].invID;

      const oldSnapshot = await getInvoiceSnapshot(transaction, invID);
      expect(oldSnapshot).not.toBeNull();

      await updateInvoice(transaction, invID, {
        clientId: oldSnapshot!.header.ClientID ?? undefined,
        subTotal: 500,
        disVal: 0,
        grandTotal: 500,
        totalBonus: 0,
        payCash: 500,
        payVisa: 0,
        paymentMethodId: 1,
        notes: 'updated by integration test',
        items: [
          { proId: 1, empId: 1, sPrice: 500, qty: 1, sValue: 500, total: 500, bonus: 0, notes: '' },
        ],
        paymentAllocations: [{ paymentMethodId: 1, amount: 500 }],
      }, 1);

      const newSnapshot = await getInvoiceSnapshot(transaction, invID);
      expect(newSnapshot).not.toBeNull();
      expect(newSnapshot!.header.GrandTotal).toBe(500);
      expect(newSnapshot!.details.length).toBe(1);
      expect(newSnapshot!.payments.length).toBeGreaterThan(0);
      expect(newSnapshot!.payments[0].PayValue).toBe(500);

      // Cash move should reflect the new total exactly once
      const cashMove = await new sql.Request(transaction)
        .input('invID', sql.Int, invID)
        .query(`SELECT COUNT(*) AS cnt, COALESCE(SUM(GrandTolal), 0) AS total FROM dbo.TblCashMove WHERE invID = @invID AND invType = N'مبيعات'`);
      expect(cashMove.recordset[0].cnt).toBe(1);
      expect(Number(cashMove.recordset[0].total)).toBe(500);
    } finally {
      await transaction.rollback();
    }
  });

  itIfDb('deleteInvoice removes the full invoice once and leaves no orphans', async () => {
    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    try {
      const headResult = await new sql.Request(transaction).query(
        `SELECT TOP 1 invID FROM dbo.TblinvServHead WHERE invType = N'مبيعات' ORDER BY invID DESC`
      );
      if (headResult.recordset.length === 0) {
        throw new Error('No sales invoice found for delete test');
      }
      const invID = headResult.recordset[0].invID;
      const oldSnapshot = await getInvoiceSnapshot(transaction, invID);
      expect(oldSnapshot).not.toBeNull();

      await deleteInvoice(transaction, invID);

      const newSnapshot = await getInvoiceSnapshot(transaction, invID);
      expect(newSnapshot).toBeNull();

      const counts = await new sql.Request(transaction)
        .input('invID', sql.Int, invID)
        .query(`
          SELECT
            (SELECT COUNT(*) FROM dbo.TblinvServHead WHERE invID = @invID AND invType = N'مبيعات') AS headCnt,
            (SELECT COUNT(*) FROM dbo.TblinvServDetail WHERE invID = @invID AND invType = N'مبيعات') AS detailCnt,
            (SELECT COUNT(*) FROM dbo.TblinvServPayment WHERE invID = @invID AND invType = N'مبيعات') AS paymentCnt,
            (SELECT COUNT(*) FROM dbo.TblCashMove WHERE invID = @invID) AS cashMoveCnt,
            (SELECT COUNT(*) FROM dbo.TblLoyaltyPointLedger WHERE SourceInvID = @invID) AS loyaltyCnt
        `);
      expect(counts.recordset[0].headCnt).toBe(0);
      expect(counts.recordset[0].detailCnt).toBe(0);
      expect(counts.recordset[0].paymentCnt).toBe(0);
      expect(counts.recordset[0].cashMoveCnt).toBe(0);
      expect(counts.recordset[0].loyaltyCnt).toBe(0);
    } finally {
      await transaction.rollback();
    }
  });
});
