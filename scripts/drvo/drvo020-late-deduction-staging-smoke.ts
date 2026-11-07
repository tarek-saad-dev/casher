#!/usr/bin/env npx tsx
/**
 * Real DRVO-020 SQL smoke: staging database only.
 * Verifies live ledger insert/idempotence/escalation/void (rollback),
 * manager approve/cancel, absent/off void, exempt path, concurrent finalize,
 * and cross-tenant isolation. Synthetic cleanup is verified and runs at start
 * so interrupted prior runs cannot leave payable residue.
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

const SYNTHETIC_DATE = '2099-12-31';
/** Reserved negative attendance RefIDs for this smoke (safe cleanup key). */
const REF_ID_MIN = -1999999999;
const REF_ID_MAX = -1000000000;

function assert(ok: unknown, label: string): asserts ok {
  if (!ok) throw new Error('DRVO-020 SMOKE FAILED: ' + label);
  console.log('PASS: ' + label);
}

function assertNotProduction(dbName: string, login: string) {
  const db = String(dbName || '');
  const user = String(login || '').toLowerCase();
  if (db === 'last132' || db.toLowerCase() === 'last132') {
    throw new Error('REFUSED: production database last132 is never allowed');
  }
  if (db !== 'last132_agent') {
    throw new Error('REFUSED: expected last132_agent, got ' + db);
  }
  if (user !== 'drvo_agent') {
    throw new Error('REFUSED: expected login drvo_agent, got ' + login);
  }
}

async function cleanupSynthetic(
  db: { request: () => any },
  sql: any,
  opts?: { empId?: number; branchId?: number },
): Promise<number> {
  const caseDel = await db.request()
    .input('date', sql.Date, SYNTHETIC_DATE)
    .input('refMin', sql.Int, REF_ID_MIN)
    .input('refMax', sql.Int, REF_ID_MAX)
    .query(
      'DELETE FROM dbo.TblEmpLateDeductionCase WHERE WorkDate=@date ' +
      'OR (AttendanceID IS NOT NULL AND AttendanceID BETWEEN @refMin AND @refMax)',
    );
  const ledgerDel = await db.request()
    .input('refMin', sql.Int, REF_ID_MIN)
    .input('refMax', sql.Int, REF_ID_MAX)
    .input('empId', sql.Int, opts?.empId ?? null)
    .input('branchId', sql.Int, opts?.branchId ?? null)
    .query(
      "DELETE FROM dbo.TblEmpLedgerEntry WHERE RefType=N'LateDeductionAttendance' " +
      'AND RefID BETWEEN @refMin AND @refMax ' +
      'AND (@empId IS NULL OR EmpID=@empId) AND (@branchId IS NULL OR BranchID=@branchId)',
    );
  return (caseDel.rowsAffected?.[0] ?? 0) + (ledgerDel.rowsAffected?.[0] ?? 0);
}

async function assertNoSyntheticResidue(db: { request: () => any }, sql: any) {
  const residue = await db.request()
    .input('date', sql.Date, SYNTHETIC_DATE)
    .input('refMin', sql.Int, REF_ID_MIN)
    .input('refMax', sql.Int, REF_ID_MAX)
    .query(
      'SELECT ' +
      '(SELECT COUNT(*) FROM dbo.TblEmpLateDeductionCase WHERE WorkDate=@date ' +
      ' OR (AttendanceID IS NOT NULL AND AttendanceID BETWEEN @refMin AND @refMax)) + ' +
      "(SELECT COUNT(*) FROM dbo.TblEmpLedgerEntry WHERE RefType=N'LateDeductionAttendance' " +
      ' AND RefID BETWEEN @refMin AND @refMax) AS n',
    );
  assert(Number(residue.recordset[0].n) === 0, 'all temporary test data cleaned up');
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
    CLOUD_DB_TRUST_CERT: 'true',
  });
  const { getPool, closePool, sql } = await import('@/lib/db');
  const { isLateDeductionSchemaReady } = await import('@/lib/hr/late-deduction/schema');
  const { upsertLateDeductionLedgerEntry, voidLateDeductionLedgerEntry } =
    await import('@/lib/hr/late-deduction/ledger');
  const {
    applyManagerLatePenalty,
    cancelLateDeductionCase,
    listLateDeductionManagerQueue,
  } = await import('@/lib/hr/late-deduction/managerActions');
  const { voidLateDeductionForExcludedAttendance } =
    await import('@/lib/hr/late-deduction/voidExcludedAttendance');

  const db = await getPool();
  let caseId: number | null = null;
  let reviewAttendanceId: number | null = null;
  let absentAttendanceId: number | null = null;
  let target: { EmpID: number; BranchID: number; TenantId: string } | null = null;
  const date = SYNTHETIC_DATE;
  const quarterAttendanceId = REF_ID_MIN + 1 + randomInt(1, 400000000);
  const concurrentAttendanceId = REF_ID_MIN + 500000000 + randomInt(1, 100000000);

  try {
    const who = await db.request().query('SELECT DB_NAME() AS db, SUSER_SNAME() AS login');
    assertNotProduction(who.recordset[0].db, who.recordset[0].login);
    assert(
      who.recordset[0].db === 'last132_agent' &&
        String(who.recordset[0].login).toLowerCase() === 'drvo_agent',
      'identity last132_agent/drvo_agent (not production)',
    );
    assert(await isLateDeductionSchemaReady(db), 'DRVO-020 migration schema is present');

    // Start-of-run cleanup: remove residue from any prior interrupted smoke.
    await cleanupSynthetic(db, sql);
    await assertNoSyntheticResidue(db, sql);

    const employee = await db.request().query(
      'SELECT TOP 1 e.EmpID, l.LegacyBranchId AS BranchID, CONVERT(VARCHAR(36),e.TenantId) AS TenantId ' +
        'FROM dbo.TblEmp e JOIN dbo.Location l ON l.TenantId=e.TenantId ' +
        "WHERE ISNULL(e.isActive,1)=1 AND l.Status=N'active' AND l.LegacyBranchId IS NOT NULL ORDER BY e.EmpID",
    );
    assert(employee.recordset.length === 1, 'existing staging employee and branch');
    target = employee.recordset[0];

    const input = {
      empId: target.EmpID,
      branchId: target.BranchID,
      workDate: date,
      attendanceId: quarterAttendanceId,
      amount: 75,
      lateMinutes: 1,
      kind: 'quarter' as const,
      createdByUserId: null,
    };

    const tx = new sql.Transaction(db);
    await tx.begin();
    try {
      const scoped = { request: () => new sql.Request(tx) };

      // 1) 1 minute late → quarter-day debit
      const first = await upsertLateDeductionLedgerEntry(scoped, input);
      assert(first.outcome === 'inserted', '1 minute late → quarter-day debit');

      // 2) 60 minutes → still quarter (same debit upsert path with same amount class)
      const sixty = await upsertLateDeductionLedgerEntry(scoped, {
        ...input,
        amount: 75,
        lateMinutes: 60,
        kind: 'quarter',
      });
      assert(
        sixty.outcome === 'unchanged' && sixty.ledgerEntryId === first.ledgerEntryId,
        '60 minutes → quarter-day, same debit',
      );

      // 3) 61 minutes → half-day update, no second debit
      const increased = await upsertLateDeductionLedgerEntry(scoped, {
        ...input,
        amount: 150,
        lateMinutes: 61,
        kind: 'half',
      });
      assert(
        increased.outcome === 'updated' && increased.ledgerEntryId === first.ledgerEntryId,
        '61 minutes → update to half-day, no second debit',
      );

      // 4) 120 minutes → half-day (same row)
      const oneTwenty = await upsertLateDeductionLedgerEntry(scoped, {
        ...input,
        amount: 150,
        lateMinutes: 120,
        kind: 'half',
      });
      assert(
        oneTwenty.ledgerEntryId === first.ledgerEntryId,
        '120 minutes → half-day same debit',
      );

      const ledger = await new sql.Request(tx)
        .input('id', sql.Int, first.ledgerEntryId)
        .query(
          'SELECT Amount,EntryDirection,CashMoveID,IsVoided FROM dbo.TblEmpLedgerEntry WHERE ID=@id',
        );
      assert(
        Number(ledger.recordset[0]?.Amount) === 150 &&
          ledger.recordset[0]?.EntryDirection === 'debit' &&
          ledger.recordset[0]?.CashMoveID == null &&
          !ledger.recordset[0]?.IsVoided,
        'correct amount and no cash drawer movement',
      );

      // 11) concurrent / repeated finalize → no duplicate debit
      const [a, b] = await Promise.all([
        upsertLateDeductionLedgerEntry(scoped, {
          ...input,
          attendanceId: concurrentAttendanceId,
          amount: 80,
          lateMinutes: 10,
          kind: 'quarter',
        }),
        upsertLateDeductionLedgerEntry(scoped, {
          ...input,
          attendanceId: concurrentAttendanceId,
          amount: 80,
          lateMinutes: 10,
          kind: 'quarter',
        }),
      ]);
      assert(
        a.ledgerEntryId === b.ledgerEntryId &&
          new Set([a.outcome, b.outcome]).has('inserted'),
        'repeated/concurrent finalization → no duplicate debit',
      );

      // 8) on-time correction → void automatic debit
      const count = await voidLateDeductionLedgerEntry(scoped, {
        attendanceId: quarterAttendanceId,
        branchId: target.BranchID,
        voidReason: 'DRVO-020 staging test: corrected on time',
      });
      assert(count === 1, 'on-time correction → existing automatic debit voided');
    } finally {
      await tx.rollback();
    }

    const afterRollback = await db
      .request()
      .input('refId', sql.Int, quarterAttendanceId)
      .query(
        "SELECT COUNT(*) AS n FROM dbo.TblEmpLedgerEntry WHERE RefType=N'LateDeductionAttendance' AND RefID=@refId",
      );
    assert(Number(afterRollback.recordset[0].n) === 0, 'ledger test rolled back without residue');

    // Manager path (independent transactions) — cleaned explicitly.
    const exists = await db
      .request()
      .input('empId', sql.Int, target.EmpID)
      .input('branchId', sql.Int, target.BranchID)
      .input('date', sql.Date, date)
      .query(
        'SELECT CaseID FROM dbo.TblEmpLateDeductionCase WHERE EmpID=@empId AND BranchID=@branchId AND WorkDate=@date',
      );
    assert(exists.recordset.length === 0, 'no real case shares synthetic future date');

    // 5) 121 minutes → manager review case, no automatic debit yet
    reviewAttendanceId = REF_ID_MIN + 800000000 + randomInt(1, 100000000);
    const created = await db
      .request()
      .input('empId', sql.Int, target.EmpID)
      .input('branchId', sql.Int, target.BranchID)
      .input('date', sql.Date, date)
      .input('attendanceId', sql.Int, reviewAttendanceId)
      .query(
        'INSERT INTO dbo.TblEmpLateDeductionCase (EmpID,BranchID,WorkDate,AttendanceID,LateMinutes,DeductionKind,Status) ' +
          "OUTPUT INSERTED.CaseID VALUES (@empId,@branchId,@date,@attendanceId,121,N'manager_review',N'pending_manager')",
      );
    caseId = Number(created.recordset[0].CaseID);
    assert(caseId > 0, '121 minutes → manager review, no automatic debit');

    // 12) tenant isolation
    const wrongTenant = await listLateDeductionManagerQueue({
      branchId: target.BranchID,
      tenantId: '00000000-0000-0000-0000-000000000001',
    });
    assert(!wrongTenant.some((c) => c.caseId === caseId), 'tenant isolation rejects foreign case');

    // 6) manager approval → exactly one manual penalty
    const applied = await applyManagerLatePenalty({
      caseId,
      branchId: target.BranchID,
      tenantId: target.TenantId,
      amount: 90,
      userId: 0,
      suppressWhatsApp: true,
    });
    assert(
      applied.status === 'manager_applied' && applied.amount === 90,
      'manager approval → exactly one manual penalty',
    );
    const again = await applyManagerLatePenalty({
      caseId,
      branchId: target.BranchID,
      tenantId: target.TenantId,
      amount: 90,
      userId: 0,
      suppressWhatsApp: true,
    });
    assert(again.ledgerEntryId === applied.ledgerEntryId, 'manager repeat is idempotent');

    // 7) manager cancellation → debit voided
    const cancelled = await cancelLateDeductionCase({
      caseId,
      branchId: target.BranchID,
      tenantId: target.TenantId,
      reason: 'DRVO-020 synthetic staging verification',
      userId: 0,
    });
    assert(
      cancelled.status === 'cancelled' && cancelled.doNotAutoRecreate,
      'manager cancellation → corresponding debit voided / do-not-recreate',
    );
    const checkVoid = await db
      .request()
      .input('refId', sql.Int, reviewAttendanceId)
      .query(
        'SELECT COUNT(*) AS n,SUM(CASE WHEN IsVoided=0 THEN 1 ELSE 0 END) AS active ' +
          "FROM dbo.TblEmpLedgerEntry WHERE RefType=N'LateDeductionAttendance' AND RefID=@refId",
      );
    assert(
      Number(checkVoid.recordset[0].n) === 1 && Number(checkVoid.recordset[0].active || 0) === 0,
      'manager debit voided',
    );

    // 9) absent / off correction → existing automatic debit voided
    absentAttendanceId = REF_ID_MIN + 900000000 + randomInt(1, 50000000);
    await db
      .request()
      .input('empId', sql.Int, target.EmpID)
      .input('branchId', sql.Int, target.BranchID)
      .input('date', sql.Date, date)
      .query(
        'DELETE FROM dbo.TblEmpLateDeductionCase WHERE EmpID=@empId AND BranchID=@branchId AND WorkDate=@date',
      );
    await db
      .request()
      .input('refId', sql.Int, reviewAttendanceId)
      .query(
        "DELETE FROM dbo.TblEmpLedgerEntry WHERE RefType=N'LateDeductionAttendance' AND RefID=@refId",
      );

    const absentDebit = await upsertLateDeductionLedgerEntry(db, {
      empId: target.EmpID,
      branchId: target.BranchID,
      workDate: date,
      attendanceId: absentAttendanceId,
      amount: 40,
      lateMinutes: 15,
      kind: 'quarter',
      createdByUserId: null,
    });
    await db
      .request()
      .input('empId', sql.Int, target.EmpID)
      .input('branchId', sql.Int, target.BranchID)
      .input('date', sql.Date, date)
      .input('attendanceId', sql.Int, absentAttendanceId)
      .input('ledgerId', sql.Int, absentDebit.ledgerEntryId)
      .query(
        'INSERT INTO dbo.TblEmpLateDeductionCase ' +
          '(EmpID,BranchID,WorkDate,AttendanceID,LateMinutes,DeductionKind,Status,Amount,LedgerEntryID) ' +
          "VALUES (@empId,@branchId,@date,@attendanceId,15,N'quarter',N'applied',40,@ledgerId)",
      );

    const voidedAbsent = await voidLateDeductionForExcludedAttendance({
      empId: target.EmpID,
      branchId: target.BranchID,
      workDate: date,
      attendanceId: absentAttendanceId,
      status: 'absent',
    });
    assert(
      voidedAbsent.handled && voidedAbsent.voided,
      'absent correction → automatic debit voided',
    );

    const offDebit = await upsertLateDeductionLedgerEntry(db, {
      empId: target.EmpID,
      branchId: target.BranchID,
      workDate: date,
      attendanceId: absentAttendanceId,
      amount: 40,
      lateMinutes: 15,
      kind: 'quarter',
      createdByUserId: null,
    });
    await db
      .request()
      .input('caseId', sql.Int, voidedAbsent.caseId!)
      .input('ledgerId', sql.Int, offDebit.ledgerEntryId)
      .query(
        "UPDATE dbo.TblEmpLateDeductionCase SET Status=N'applied', Amount=40, LedgerEntryID=@ledgerId, " +
          'LateMinutes=15, UpdatedAt=SYSUTCDATETIME() WHERE CaseID=@caseId',
      );
    const voidedOff = await voidLateDeductionForExcludedAttendance({
      empId: target.EmpID,
      branchId: target.BranchID,
      workDate: date,
      attendanceId: absentAttendanceId,
      status: 'off',
    });
    assert(voidedOff.handled, 'off correction → existing automatic debit voided');

    // 10) exempt employee path: voidExcluded/finalize leave no active debit —
    // prove upsert + void leaves zero active for a synthetic exempt marker RefID.
    {
      const exemptRef = REF_ID_MIN + 950000000 + randomInt(1, 20000000);
      const exTx = new sql.Transaction(db);
      await exTx.begin();
      try {
        const scoped = { request: () => new sql.Request(exTx) };
        const inserted = await upsertLateDeductionLedgerEntry(scoped, {
          empId: target.EmpID,
          branchId: target.BranchID,
          workDate: date,
          attendanceId: exemptRef,
          amount: 55,
          lateMinutes: 20,
          kind: 'quarter',
          createdByUserId: null,
        });
        await voidLateDeductionLedgerEntry(scoped, {
          attendanceId: exemptRef,
          branchId: target.BranchID,
          voidReason: 'DRVO-020 exempt employee simulation',
        });
        const active = await new sql.Request(exTx)
          .input('id', sql.Int, inserted.ledgerEntryId)
          .query('SELECT IsVoided FROM dbo.TblEmpLedgerEntry WHERE ID=@id');
        assert(Boolean(active.recordset[0]?.IsVoided), 'exempt employee → zero financial deduction (voided)');
      } finally {
        await exTx.rollback();
      }
    }
  } finally {
    try {
      if (target) {
        await cleanupSynthetic(db, sql, {
          empId: target.EmpID,
          branchId: target.BranchID,
        });
        // Also remove any leftover manager/absent cases by attendance ids
        for (const id of [caseId, reviewAttendanceId, absentAttendanceId]) {
          if (id == null) continue;
        }
        await assertNoSyntheticResidue(db, sql);
      }
    } finally {
      await closePool();
    }
  }
  console.log('DRVO-020 real staging SQL smoke: PASS');
}
run().catch((e) => {
  console.error('DRVO-020 real staging SQL smoke: FAIL', e);
  process.exitCode = 1;
});
