#!/usr/bin/env npx tsx
/**
 * Acceptance tests for employee funding sync against live DB.
 * Creates a temporary CashMove on طارق category, exercises CRUD sync, then deletes it.
 */
import path from 'path';
import dotenv from 'dotenv';
import sql from 'mssql';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const config: sql.config = {
  server: process.env.CLOUD_DB_SERVER || process.env.DB_SERVER || '',
  port: parseInt(process.env.CLOUD_DB_PORT || process.env.DB_PORT || '1433', 10),
  database: process.env.CLOUD_DB_NAME || process.env.DB_DATABASE || '',
  user: process.env.CLOUD_DB_USER || process.env.DB_USER || '',
  password: process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD || '',
  options: {
    encrypt: true,
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    enableArithAbort: true,
  },
};

async function syncFromCashMove(tx: sql.Transaction, cashMoveId: number): Promise<string> {
  const cm = await new sql.Request(tx)
    .input('id', sql.Int, cashMoveId)
    .query(`
      SELECT cm.ID, cm.ExpINID, cm.GrandTolal, cm.invDate,
        ISNULL(cm.IsEmployeePayrollIncome,0) AS IsEmployeePayrollIncome,
        cat.CatName
      FROM dbo.TblCashMove cm
      LEFT JOIN dbo.TblExpINCat cat ON cat.ExpINID = cm.ExpINID
      WHERE cm.ID = @id
    `);
  const row = cm.recordset[0];
  const map = await new sql.Request(tx)
    .input('ExpINID', sql.Int, row.ExpINID)
    .query(`
      SELECT TOP 1 e.EmpID
      FROM dbo.TblExpCatEmpMap m
      INNER JOIN dbo.TblExpINCat c ON c.ExpINID = m.ExpINID AND c.ExpINType = N'ايرادات'
      INNER JOIN dbo.TblEmp e ON e.EmpID = m.EmpID
      WHERE m.ExpINID = @ExpINID AND m.TxnKind = N'revenue' AND m.IsActive = 1
      ORDER BY m.ID DESC
    `);

  if (map.recordset.length === 0) {
    await new sql.Request(tx)
      .input('id', sql.Int, cashMoveId)
      .query(`DELETE FROM dbo.TblEmpLedgerEntry WHERE CashMoveID = @id AND EntryReason = N'employee_funding'`);
    return 'deleted';
  }

  const empId = Number(map.recordset[0].EmpID);
  const amount = Math.abs(Number(row.GrandTolal));
  const entryDate = (row.invDate as Date).toISOString().slice(0, 10);
  const notes = `ACCEPTANCE sync CashMove#${cashMoveId}`;
  const payrollMonth = entryDate.slice(0, 7);

  await new sql.Request(tx)
    .input('id', sql.Int, cashMoveId)
    .input('emp', sql.Int, empId)
    .query(`UPDATE dbo.TblCashMove SET EmpID = @emp WHERE ID = @id`);

  const upd = await new sql.Request(tx)
    .input('EmpID', sql.Int, empId)
    .input('EntryDate', sql.Date, entryDate)
    .input('Amount', sql.Decimal(12, 2), amount)
    .input('PayrollMonth', sql.NVarChar(7), payrollMonth)
    .input('CashMoveID', sql.Int, cashMoveId)
    .input('Notes', sql.NVarChar(500), notes)
    .input('RefType', sql.NVarChar(80), 'TblCashMove')
    .input('RefID', sql.Int, cashMoveId)
    .input('EntryReason', sql.NVarChar(40), 'employee_funding')
    .query(`
      UPDATE dbo.TblEmpLedgerEntry
      SET EmpID=@EmpID, EntryDate=@EntryDate, Amount=@Amount, PayrollMonth=@PayrollMonth,
          CashMoveID=@CashMoveID, Notes=@Notes, IsVoided=0, VoidReason=NULL, UpdatedAt=SYSDATETIME()
      WHERE RefType=@RefType AND RefID=@RefID AND EntryReason=@EntryReason AND IsVoided=0
    `);
  if (Number(upd.rowsAffected[0] ?? 0) > 0) return 'updated';

  await new sql.Request(tx)
    .input('EmpID', sql.Int, empId)
    .input('EntryDate', sql.Date, entryDate)
    .input('Amount', sql.Decimal(12, 2), amount)
    .input('PayrollMonth', sql.NVarChar(7), payrollMonth)
    .input('CashMoveID', sql.Int, cashMoveId)
    .input('Notes', sql.NVarChar(500), notes)
    .input('RefType', sql.NVarChar(80), 'TblCashMove')
    .input('RefID', sql.Int, cashMoveId)
    .input('EntryReason', sql.NVarChar(40), 'employee_funding')
    .query(`
      INSERT INTO dbo.TblEmpLedgerEntry (
        EmpID, EntryDate, EntryDirection, EntryReason, Amount,
        PayrollMonth, RefType, RefID, CashMoveID, AttendanceID,
        Notes, IsVoided, CreatedByUserID, CreatedAt
      ) VALUES (
        @EmpID, @EntryDate, N'credit', @EntryReason, @Amount,
        @PayrollMonth, @RefType, @RefID, @CashMoveID, NULL,
        @Notes, 0, NULL, SYSDATETIME()
      )
    `);
  return 'inserted';
}

async function main() {
  const pool = await sql.connect(config);
  const results: Record<string, unknown>[] = [];

  const pm = await pool.request().query(`SELECT TOP 1 PaymentID FROM dbo.TblPaymentMethods ORDER BY PaymentID`);
  const paymentId = Number(pm.recordset[0].PaymentID);
  const expInId = 1053; // طارق

  const other = await pool.request().query(`
    SELECT TOP 1 c.ExpINID
    FROM dbo.TblExpINCat c
    WHERE c.ExpINType = N'ايرادات'
      AND c.ExpINID <> 1053
      AND NOT EXISTS (
        SELECT 1 FROM dbo.TblExpCatEmpMap m
        WHERE m.ExpINID = c.ExpINID AND m.TxnKind = N'revenue' AND m.IsActive = 1
      )
  `);
  const otherExp = Number(other.recordset[0].ExpINID);

  let cashMoveId = 0;
  let ledgerId = 0;

  // 1) create 1 EGP
  {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    const ins = await new sql.Request(tx)
      .input('exp', sql.Int, expInId)
      .input('pm', sql.Int, paymentId)
      .input('amt', sql.Decimal(10, 2), 1)
      .query(`
        INSERT INTO dbo.TblCashMove (
          invID, invType, invDate, invTime, ClientID, ExpINID, GrandTolal, inOut, Notes, ShiftMoveID, PaymentMethodID
        )
        OUTPUT INSERTED.ID
        VALUES (999001, N'ايرادات', '2026-07-14', '21:00', NULL, @exp, @amt, N'in', N'ACCEPTANCE_TEST_FUNDING', NULL, @pm)
      `);
    cashMoveId = Number(ins.recordset[0].ID);
    const outcome = await syncFromCashMove(tx, cashMoveId);
    await tx.commit();
    const led = await pool.request().input('id', sql.Int, cashMoveId).query(`
      SELECT ID, Amount FROM dbo.TblEmpLedgerEntry
      WHERE CashMoveID=@id AND EntryReason=N'employee_funding' AND IsVoided=0
    `);
    ledgerId = Number(led.recordset[0]?.ID);
    results.push({
      step: 1,
      ok: led.recordset.length === 1 && Number(led.recordset[0].Amount) === 1 && outcome === 'inserted',
      cashMoveId,
      ledgerId,
      outcome,
    });
  }

  // 2) amount -> 2
  {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    await new sql.Request(tx).input('id', sql.Int, cashMoveId).query(`UPDATE dbo.TblCashMove SET GrandTolal=2 WHERE ID=@id`);
    const outcome = await syncFromCashMove(tx, cashMoveId);
    await tx.commit();
    const led = await pool.request().input('id', sql.Int, cashMoveId).query(`
      SELECT ID, Amount FROM dbo.TblEmpLedgerEntry
      WHERE CashMoveID=@id AND EntryReason=N'employee_funding' AND IsVoided=0
    `);
    results.push({
      step: 2,
      ok: led.recordset.length === 1 && Number(led.recordset[0].Amount) === 2 && Number(led.recordset[0].ID) === ledgerId,
      outcome,
    });
  }

  // 3) unmapped category
  {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    await new sql.Request(tx)
      .input('id', sql.Int, cashMoveId)
      .input('exp', sql.Int, otherExp)
      .query(`UPDATE dbo.TblCashMove SET ExpINID=@exp WHERE ID=@id`);
    const outcome = await syncFromCashMove(tx, cashMoveId);
    await tx.commit();
    const led = await pool.request().input('id', sql.Int, cashMoveId).query(`
      SELECT COUNT(*) AS c FROM dbo.TblEmpLedgerEntry WHERE CashMoveID=@id AND EntryReason=N'employee_funding'
    `);
    results.push({
      step: 3,
      ok: Number(led.recordset[0].c) === 0 && outcome === 'deleted',
      outcome,
    });
  }

  // 4) restore طارق
  {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    await new sql.Request(tx)
      .input('id', sql.Int, cashMoveId)
      .input('exp', sql.Int, expInId)
      .query(`UPDATE dbo.TblCashMove SET ExpINID=@exp, GrandTolal=2 WHERE ID=@id`);
    const outcome = await syncFromCashMove(tx, cashMoveId);
    await tx.commit();
    const led = await pool.request().input('id', sql.Int, cashMoveId).query(`
      SELECT COUNT(*) AS c FROM dbo.TblEmpLedgerEntry
      WHERE CashMoveID=@id AND EntryReason=N'employee_funding' AND IsVoided=0
    `);
    results.push({
      step: 4,
      ok: Number(led.recordset[0].c) === 1 && outcome === 'inserted',
      outcome,
    });
  }

  // 5) delete
  {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    await new sql.Request(tx).input('id', sql.Int, cashMoveId)
      .query(`DELETE FROM dbo.TblEmpLedgerEntry WHERE CashMoveID=@id`);
    await new sql.Request(tx).input('id', sql.Int, cashMoveId)
      .query(`DELETE FROM dbo.TblCashMove WHERE ID=@id`);
    await tx.commit();
    const leftCm = await pool.request().input('id', sql.Int, cashMoveId)
      .query(`SELECT COUNT(*) AS c FROM dbo.TblCashMove WHERE ID=@id`);
    const leftLed = await pool.request().input('id', sql.Int, cashMoveId)
      .query(`SELECT COUNT(*) AS c FROM dbo.TblEmpLedgerEntry WHERE CashMoveID=@id`);
    results.push({
      step: 5,
      ok: Number(leftCm.recordset[0].c) === 0 && Number(leftLed.recordset[0].c) === 0,
    });
  }

  console.table(results);
  const allOk = results.every((r) => r.ok === true);
  await pool.close();
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
