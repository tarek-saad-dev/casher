#!/usr/bin/env npx tsx
/**
 * Real DRVO-020 SQL smoke: staging database only.
 * Verifies live ledger insert/idempotence/escalation/void (rollback),
 * manager approve/cancel and cross-tenant isolation (synthetic cleanup).
 * No WhatsApp messages and no production DB access.
 */
import Module from 'node:module';
import { randomInt } from 'node:crypto';

const mod = Module as unknown as {
  _load: (name: string, parent: unknown, isMain: boolean) => unknown;
};
const nativeLoad = mod._load;
mod._load = function(name, parent, isMain) {
  if (name === 'server-only') return {};
  return nativeLoad.call(mod, name, parent, isMain);
};
function assert(ok: unknown, label: string): asserts ok {
  if (!ok) throw new Error('DRVO-020 SMOKE FAILED: ' + label);
  console.log('PASS: ' + label);
}

async function run() {
  const password = process.env.DRVO_STAGING_DB_PASSWORD;
  if (!password) throw new Error('Dedicated DRVO_STAGING_DB_PASSWORD required');
  Object.assign(process.env, {
    DB_SERVER: '127.0.0.1', DB_PORT: '14330',
    DB_DATABASE: 'last132_agent', DB_USER: 'drvo_agent', DB_PASSWORD: password,
    DB_ENCRYPT: 'false', DB_TRUST_SERVER_CERTIFICATE: 'true',
    CLOUD_DB_SERVER: '127.0.0.1', CLOUD_DB_PORT: '14330',
    CLOUD_DB_NAME: 'last132_agent', CLOUD_DB_USER: 'drvo_agent',
    CLOUD_DB_PASSWORD: password, CLOUD_DB_ENCRYPT: 'false',
    CLOUD_DB_TRUST_CERT: 'true'
  });
  const { getPool, closePool, sql } = await import('@/lib/db');
  const { isLateDeductionSchemaReady } = await import('@/lib/hr/late-deduction/schema');
  const { upsertLateDeductionLedgerEntry, voidLateDeductionLedgerEntry } =
    await import('@/lib/hr/late-deduction/ledger');
  const { applyManagerLatePenalty, cancelLateDeductionCase, listLateDeductionManagerQueue } =
    await import('@/lib/hr/late-deduction/managerActions');

  const db = await getPool();
  let caseId: number | null = null;
  let reviewAttendanceId: number | null = null;
  let target: { EmpID: number; BranchID: number; TenantId: string } | null = null;
  const date = '2099-12-31';
  const quarterAttendanceId = -1100000000 - randomInt(100000,100000000);
  try {
    const who = await db.request().query('SELECT DB_NAME() AS db, SUSER_SNAME() AS login');
    assert(who.recordset[0].db === 'last132_agent' &&
      String(who.recordset[0].login).toLowerCase() === 'drvo_agent',
      'identity last132_agent/drvo_agent (not production)');
    assert(await isLateDeductionSchemaReady(db), 'DRVO-020 migration schema is present');
    const employee = await db.request().query(
      'SELECT TOP 1 e.EmpID, l.LegacyBranchId AS BranchID, CONVERT(VARCHAR(36),e.TenantId) AS TenantId ' +
      'FROM dbo.TblEmp e JOIN dbo.Location l ON l.TenantId=e.TenantId ' +
      "WHERE ISNULL(e.isActive,1)=1 AND l.Status=N'active' AND l.LegacyBranchId IS NOT NULL ORDER BY e.EmpID");
    assert(employee.recordset.length===1,'existing staging employee and branch');
    target = employee.recordset[0];
    const input = {
      empId: target.EmpID, branchId: target.BranchID,
      workDate: date, attendanceId: quarterAttendanceId,
      amount: 75, lateMinutes: 1, kind: 'quarter', createdByUserId: null
    };
    const tx = new sql.Transaction(db);
    await tx.begin();
    try {
      const scoped = { request: () => new sql.Request(tx) };
      const first = await upsertLateDeductionLedgerEntry(scoped, input);
      assert(first.outcome === 'inserted','quarter-day debit inserted into real ledger table');
      const repeated = await upsertLateDeductionLedgerEntry(scoped,input);
      assert(repeated.outcome === 'unchanged' && repeated.ledgerEntryId===first.ledgerEntryId,
        'duplicate check-in uses existing debit');
      const increased = await upsertLateDeductionLedgerEntry(scoped,{
        ...input, amount: 150, lateMinutes: 61, kind: 'half'
      });
      assert(increased.outcome === 'updated' && increased.ledgerEntryId===first.ledgerEntryId,
        '61 minutes upgrades same ledger debit, not a second debit');
      const ledger = await new sql.Request(tx)
        .input('id',sql.Int,first.ledgerEntryId)
        .query('SELECT Amount,EntryDirection,CashMoveID,IsVoided FROM dbo.TblEmpLedgerEntry WHERE ID=@id');
      assert(Number(ledger.recordset[0]?.Amount)===150 &&
        ledger.recordset[0]?.EntryDirection==='debit' &&
        ledger.recordset[0]?.CashMoveID==null && !ledger.recordset[0]?.IsVoided,
        'correct amount and no cash drawer movement');
      const count = await voidLateDeductionLedgerEntry(scoped,{
        attendanceId: quarterAttendanceId, branchId: target.BranchID,
        voidReason: 'DRVO-020 staging test: corrected on time'
      });
      assert(count===1,'corrected on-time deduction voided exactly once');
    } finally {
      await tx.rollback();
    }
    const afterRollback = await db.request().input('refId',sql.Int,quarterAttendanceId)
      .query("SELECT COUNT(*) AS n FROM dbo.TblEmpLedgerEntry WHERE RefType=N'LateDeductionAttendance' AND RefID=@refId");
    assert(Number(afterRollback.recordset[0].n)===0,'ledger test rolled back without residue');

    const exists = await db.request()
      .input('empId',sql.Int,target.EmpID).input('branchId',sql.Int,target.BranchID)
      .input('date',sql.Date,date)
      .query('SELECT CaseID FROM dbo.TblEmpLateDeductionCase WHERE EmpID=@empId AND BranchID=@branchId AND WorkDate=@date');
    assert(exists.recordset.length===0,'no real case shares synthetic future date');
    reviewAttendanceId = -1300000000 - randomInt(100000,100000000);
    const created = await db.request()
      .input('empId',sql.Int,target.EmpID).input('branchId',sql.Int,target.BranchID)
      .input('date',sql.Date,date).input('attendanceId',sql.Int,reviewAttendanceId)
      .query("INSERT INTO dbo.TblEmpLateDeductionCase (EmpID,BranchID,WorkDate,AttendanceID,LateMinutes,DeductionKind,Status) " +
        "OUTPUT INSERTED.CaseID VALUES (@empId,@branchId,@date,@attendanceId,130,N'manager_review',N'pending_manager')");
    caseId = Number(created.recordset[0].CaseID);
    assert(caseId>0,'synthetic manager-review case created');
    const wrongTenant = await listLateDeductionManagerQueue({
      branchId:target.BranchID,tenantId:'00000000-0000-0000-0000-000000000001'
    });
    assert(!wrongTenant.some(c=>c.caseId===caseId),'tenant isolation rejects foreign case');
    const applied = await applyManagerLatePenalty({
      caseId,branchId:target.BranchID,tenantId:target.TenantId,amount:90,userId:0,suppressWhatsApp:true
    });
    assert(applied.status==='manager_applied' && applied.amount===90,
      'manager applies a penalty after 121 minutes');
    const again = await applyManagerLatePenalty({
      caseId,branchId:target.BranchID,tenantId:target.TenantId,amount:90,userId:0,suppressWhatsApp:true
    });
    assert(again.ledgerEntryId===applied.ledgerEntryId,'manager repeat is idempotent');
    const cancelled = await cancelLateDeductionCase({
      caseId,branchId:target.BranchID,tenantId:target.TenantId,
      reason:'DRVO-020 synthetic staging verification',userId:0
    });
    assert(cancelled.status==='cancelled' && cancelled.doNotAutoRecreate,
      'manager can cancel and prevent re-creating the debit');
    const checkVoid = await db.request().input('refId',sql.Int,reviewAttendanceId)
      .query("SELECT COUNT(*) AS n,SUM(CASE WHEN IsVoided=0 THEN 1 ELSE 0 END) AS active " +
        "FROM dbo.TblEmpLedgerEntry WHERE RefType=N'LateDeductionAttendance' AND RefID=@refId");
    assert(Number(checkVoid.recordset[0].n)===1 &&
      Number(checkVoid.recordset[0].active||0)===0,'manager debit voided');
  } finally {
    // Only synthetic records are removed. Staging identity was verified before writes.
    try {
      if (target && reviewAttendanceId != null) {
        if (caseId != null) {
          await db.request().input('caseId',sql.Int,caseId)
            .input('attendanceId',sql.Int,reviewAttendanceId)
            .query('DELETE FROM dbo.TblEmpLateDeductionCase WHERE CaseID=@caseId AND AttendanceID=@attendanceId');
        }
        await db.request().input('empId',sql.Int,target.EmpID)
          .input('branchId',sql.Int,target.BranchID)
          .input('refId',sql.Int,reviewAttendanceId)
          .query("DELETE FROM dbo.TblEmpLedgerEntry WHERE EmpID=@empId AND BranchID=@branchId " +
            "AND RefType=N'LateDeductionAttendance' AND RefID=@refId");
        const residue = await db.request().input('attendanceId',sql.Int,reviewAttendanceId)
          .query("SELECT (SELECT COUNT(*) FROM dbo.TblEmpLateDeductionCase WHERE AttendanceID=@attendanceId) + " +
            "(SELECT COUNT(*) FROM dbo.TblEmpLedgerEntry WHERE RefType=N'LateDeductionAttendance' AND RefID=@attendanceId) AS n");
        assert(Number(residue.recordset[0].n)===0,'synthetic manager data fully removed');
      }
    } finally {
      await closePool();
    }
  }
  console.log('DRVO-020 real staging SQL smoke: PASS');
}
run().catch(e=>{console.error('DRVO-020 real staging SQL smoke: FAIL',e);process.exitCode=1;});
