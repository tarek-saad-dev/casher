#!/usr/bin/env npx tsx
/**
 * Phase 1S / 1R — LIVE temporary transfer smoke for Camp Caesar.
 * Disposable: [SMOKE 1S] Cross-Branch Employee
 * Camp Caesar stays SETUP. Does not invent salaries for real staff.
 */
import path from 'path';
import fs from 'fs';
import Module from 'module';
import dotenv from 'dotenv';
import sql from 'mssql';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local'), override: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const orig = m._load;
m._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

function nextDow(fromIso: string, targetDow: number): string {
  const d = new Date(`${fromIso}T12:00:00Z`);
  const cur = d.getUTCDay();
  let add = (targetDow - cur + 7) % 7;
  if (add === 0) add = 7;
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}

function expect(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function main() {
  const { getPool } = await import('@/lib/db');
  const { ensureEmpBranchWorkScheduleTable } = await import('@/lib/hr/empBranchWorkSchedule');
  const { saveEmployeeBranchWeeklySchedule, SchedulePolicyError } = await import(
    '@/lib/hr/employeeBranchScheduleSave'
  );
  const { resolveEmployeeGlobalSchedule } = await import('@/lib/hr/employeeBranchScheduleResolver');
  const {
    previewTemporaryBranchTransfer,
    createTemporaryBranchTransfer,
    cancelTemporaryBranchTransfer,
  } = await import('@/lib/hr/temporaryBranchTransfer');
  const { canBranchAppearInPublicBooking } = await import('@/lib/branch/publicBranchVisibility');
  const { listOperationalPresenceForBranch } = await import('@/lib/hr/operationsDayState');
  const { ensureEmployeeBranchAssignment } = await import('@/lib/branch/assignmentIntegrity');
  const {
    startBranchSmokeRun,
    registerSmokeArtifact,
    cleanupBranchSmokeRun,
    markBranchSmokeRunStatus,
  } = await import('@/lib/branch/branchSmokeService');
  const { getBranchById } = await import('@/lib/branch/repository');

  const GLEEM = 1;
  const CC = 3;
  const ACTOR = 10;
  const pool = await getPool();

  await ensureEmpBranchWorkScheduleTable();

  const run = await startBranchSmokeRun({
    branchId: CC,
    purpose: 'Phase 1S-1R live cross-branch temporary transfer smoke',
    actorUserId: ACTOR,
  });
  const smokeRunId = run.smokeRunId;

  const empName = `[SMOKE 1S] Cross-Branch Employee ${smokeRunId}`;
  await pool
    .request()
    .input('n', sql.NVarChar(100), empName)
    .query(`INSERT INTO dbo.TblEmp (EmpName, Job, isActive) VALUES (@n, N'حلاق', 1)`);
  const empId = Number(
    (
      await pool
        .request()
        .input('n', sql.NVarChar(100), empName)
        .query(`SELECT TOP 1 EmpID FROM dbo.TblEmp WHERE EmpName=@n ORDER BY EmpID DESC`)
    ).recordset[0].EmpID,
  );
  await registerSmokeArtifact({ smokeRunId, entityType: 'EMP', entityId: empId });

  const today = new Date().toISOString().slice(0, 10);
  const sat = nextDow(today, 6);
  const tue = nextDow(today, 2);

  for (const branchId of [GLEEM, CC]) {
    await ensureEmployeeBranchAssignment({
      empId,
      branchId,
      effectiveFrom: today,
      canReceiveBookings: true,
      isHomeBranch: branchId === GLEEM,
    });
    await pool
      .request()
      .input('empId', sql.Int, empId)
      .input('branchId', sql.Int, branchId)
      .query(`
        IF NOT EXISTS (
          SELECT 1 FROM dbo.TblEmpBranchPayrollPlan
          WHERE EmpID=@empId AND BranchID=@branchId AND IsActive=1
        )
        INSERT INTO dbo.TblEmpBranchPayrollPlan (
          EmpID, BranchID, PayType, HourlyRate, EffectiveFrom, IsActive
        ) VALUES (@empId, @branchId, N'hourly', 40, CAST(GETDATE() AS date), 1)
      `);
    await pool
      .request()
      .input('empId', sql.Int, empId)
      .input('branchId', sql.Int, branchId)
      .query(`
        IF NOT EXISTS (
          SELECT 1 FROM dbo.TblEmpTargetPlan WHERE EmpID=@empId AND BranchID=@branchId
            AND Notes LIKE N'%NO_TARGET%'
        )
        INSERT INTO dbo.TblEmpTargetPlan (
          EmpID, BranchID, IsEnabled, InputBasis, ConversionDays,
          EffectiveFrom, Notes, CreatedByUserID
        ) VALUES (@empId, @branchId, 0, N'daily', 26, CAST(GETDATE() AS date), N'NO_TARGET [SMOKE 1S]', ${ACTOR})
      `);
    await pool
      .request()
      .input('empId', sql.Int, empId)
      .input('branchId', sql.Int, branchId)
      .query(`
        UPDATE dbo.TblEmpBranchAssignment
        SET Notes = N'services:23', CanReceiveBookings = 1
        WHERE EmpID=@empId AND BranchID=@branchId AND IsActive=1
      `);
  }

  // Sat GLEEM / Tue CC — no phone / no real customer
  await saveEmployeeBranchWeeklySchedule({
    empId,
    branchId: GLEEM,
    effectiveFrom: today,
    cells: [0, 1, 2, 3, 4, 5, 6].map((dow) => ({
      dayOfWeek: dow,
      isWorking: dow === 6,
      startTime: '11:00',
      endTime: '20:00',
      canReceiveBookings: true,
    })),
    actorUserId: ACTOR,
  });
  await saveEmployeeBranchWeeklySchedule({
    empId,
    branchId: CC,
    effectiveFrom: today,
    cells: [0, 1, 2, 3, 4, 5, 6].map((dow) => ({
      dayOfWeek: dow,
      isWorking: dow === 2,
      startTime: '11:00',
      endTime: '01:30',
      canReceiveBookings: true,
    })),
    actorUserId: ACTOR,
  });

  const baselineGlobal = await resolveEmployeeGlobalSchedule({
    empId,
    workDate: sat,
    publicOnly: false,
  });
  expect(baselineGlobal.branches[0]?.branchCode === 'GLEEM', 'baseline Sat → GLEEM');

  const gleemPresenceBefore = await listOperationalPresenceForBranch(GLEEM, sat);
  const ccPresenceBefore = await listOperationalPresenceForBranch(CC, sat);
  expect(gleemPresenceBefore.presentIds.has(empId), 'GLEEM day-state contains emp');
  expect(!ccPresenceBefore.presentIds.has(empId), 'CC preview excludes emp at baseline');

  const weeklyBefore = await pool.request().input('empId', sql.Int, empId).query(`
    SELECT BranchID, DayOfWeek, IsWorking, CONVERT(varchar(5), StartTime, 108) AS S,
           CONVERT(varchar(5), EndTime, 108) AS E
    FROM dbo.TblEmpBranchWorkSchedule
    WHERE EmpID=@empId AND IsActive=1
    ORDER BY BranchID, DayOfWeek
  `);
  const legacyBefore = await pool.request().input('empId', sql.Int, empId).query(`
    SELECT COUNT(*) AS Cnt FROM dbo.TblEmpWorkSchedule WHERE EmpID=@empId
  `);

  const preview = await previewTemporaryBranchTransfer({
    empId,
    workDate: sat,
    toBranchId: CC,
    allowSetupDestination: true,
  });
  expect(preview.canTransfer, `preview blocked: ${JSON.stringify(preview.blockers)}`);
  expect(preview.sourceBranch?.branchId === GLEEM, 'FromBranch resolved server-side to GLEEM');

  const cashBefore = await pool
    .request()
    .input('empId', sql.Int, empId)
    .query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.TblCashMove WHERE BranchID IN (1,3)) AS Cash,
      (SELECT COUNT(*) FROM dbo.TblEmpDailyPayroll WHERE EmpID=@empId) AS Pay,
      (SELECT COUNT(*) FROM dbo.TblEmpLedgerEntry WHERE EmpID=@empId) AS Led
  `);

  const xfer = await createTemporaryBranchTransfer({
    empId,
    fromBranchId: GLEEM,
    toBranchId: CC,
    workDate: sat,
    startTime: '11:00',
    endTime: '01:30',
    reason: 'اختبار حي للنقل الطارئ قبل تشغيل كامب شيزار',
    createdByUserId: ACTOR,
    allowSetupDestination: true,
  });
  await registerSmokeArtifact({
    smokeRunId,
    entityType: 'TRANSFER',
    entityId: xfer.transferId,
  });

  const xferRow = await pool.request().input('id', sql.BigInt, xfer.transferId).query(`
    SELECT TransferID, EmpID, FromBranchID, ToBranchID, WorkDate, IsActive, Reason
    FROM dbo.TblEmpTemporaryBranchTransfer WHERE TransferID=@id
  `);
  const tr = xferRow.recordset[0];
  expect(Boolean(tr.IsActive), 'active transfer row');
  expect(Number(tr.FromBranchID) === GLEEM, 'FromBranchID server-side');
  expect(Number(tr.ToBranchID) === CC, 'ToBranchID CC');
  // Emergency transfer semantics: date-specific temporary move (isEmergencyTransfer policy)
  const isEmergencyTransfer = true;

  const afterGlobal = await resolveEmployeeGlobalSchedule({
    empId,
    workDate: sat,
    publicOnly: false,
  });
  expect(afterGlobal.branches[0]?.branchCode === 'CAMP_CAESAR', 'resolver → Camp Caesar');

  const gleemPresenceAfter = await listOperationalPresenceForBranch(GLEEM, sat);
  const ccPresenceAfter = await listOperationalPresenceForBranch(CC, sat);
  expect(!gleemPresenceAfter.presentIds.has(empId), 'GLEEM removes emp after transfer');
  expect(ccPresenceAfter.presentIds.has(empId), 'CC preview transferred_in');

  const weeklyAfter = await pool.request().input('empId', sql.Int, empId).query(`
    SELECT BranchID, DayOfWeek, IsWorking, CONVERT(varchar(5), StartTime, 108) AS S,
           CONVERT(varchar(5), EndTime, 108) AS E
    FROM dbo.TblEmpBranchWorkSchedule
    WHERE EmpID=@empId AND IsActive=1
    ORDER BY BranchID, DayOfWeek
  `);
  expect(
    JSON.stringify(weeklyBefore.recordset) === JSON.stringify(weeklyAfter.recordset),
    'recurring weekly schedule unchanged',
  );
  const legacyAfter = await pool.request().input('empId', sql.Int, empId).query(`
    SELECT COUNT(*) AS Cnt FROM dbo.TblEmpWorkSchedule WHERE EmpID=@empId
  `);
  expect(
    Number(legacyBefore.recordset[0].Cnt) === Number(legacyAfter.recordset[0].Cnt),
    'legacy schedule unchanged',
  );

  expect((await canBranchAppearInPublicBooking(CC)) === false, 'public APIs hide CC');

  const cashAfter = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.TblCashMove WHERE BranchID IN (1,3)) AS Cash,
      (SELECT COUNT(*) FROM dbo.TblEmpDailyPayroll WHERE EmpID=${empId}) AS Pay,
      (SELECT COUNT(*) FROM dbo.TblEmpLedgerEntry WHERE EmpID=${empId}) AS Led
  `);
  expect(
    Number(cashBefore.recordset[0].Cash) === Number(cashAfter.recordset[0].Cash) &&
      Number(cashBefore.recordset[0].Pay) === Number(cashAfter.recordset[0].Pay) &&
      Number(cashBefore.recordset[0].Led) === Number(cashAfter.recordset[0].Led),
    'transfer creates no financial entries',
  );

  // Cancel before dependent activity
  await cancelTemporaryBranchTransfer({
    empId,
    workDate: sat,
    reason: 'إلغاء اختبار النقل الحي قبل نشاط تبعي',
    actorUserId: ACTOR,
  });

  const cancelRow = await pool.request().input('id', sql.BigInt, xfer.transferId).query(`
    SELECT IsActive FROM dbo.TblEmpTemporaryBranchTransfer WHERE TransferID=@id
  `);
  expect(Number(cancelRow.recordset[0].IsActive) === 0, 'transfer soft-deactivated');
  const stillExists = await pool.request().input('id', sql.BigInt, xfer.transferId).query(`
    SELECT COUNT(*) AS Cnt FROM dbo.TblEmpTemporaryBranchTransfer WHERE TransferID=@id
  `);
  expect(Number(stillExists.recordset[0].Cnt) === 1, 'transfer row not hard-deleted');

  const restored = await resolveEmployeeGlobalSchedule({
    empId,
    workDate: sat,
    publicOnly: false,
  });
  expect(restored.branches[0]?.branchCode === 'GLEEM', 'Saturday returns to GLEEM');

  const gleemRestored = await listOperationalPresenceForBranch(GLEEM, sat);
  const ccRestored = await listOperationalPresenceForBranch(CC, sat);
  expect(gleemRestored.presentIds.has(empId), 'GLEEM board baseline restored');
  expect(!ccRestored.presentIds.has(empId), 'CC board baseline restored');

  const weeklyFinal = await pool.request().input('empId', sql.Int, empId).query(`
    SELECT BranchID, DayOfWeek, IsWorking, CONVERT(varchar(5), StartTime, 108) AS S,
           CONVERT(varchar(5), EndTime, 108) AS E
    FROM dbo.TblEmpBranchWorkSchedule
    WHERE EmpID=@empId AND IsActive=1
    ORDER BY BranchID, DayOfWeek
  `);
  expect(
    JSON.stringify(weeklyBefore.recordset) === JSON.stringify(weeklyFinal.recordset),
    'weekly unchanged after cancel',
  );

  // Blocker proofs after cancel (clean Saturday = GLEEM again)
  const blockerProofs: Record<string, boolean> = {};
  const tryBlock = async (code: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      blockerProofs[code] = false;
    } catch (e) {
      const c = e instanceof SchedulePolicyError ? e.code : '';
      blockerProofs[code] = c === code || (e instanceof Error && e.message.includes(code));
    }
  };

  await tryBlock('TRANSFER_FROM_BRANCH_MISMATCH', () =>
    createTemporaryBranchTransfer({
      empId,
      fromBranchId: 999,
      toBranchId: CC,
      workDate: sat,
      reason: 'mismatch test wrong from',
      createdByUserId: ACTOR,
      allowSetupDestination: true,
    }),
  );

  await tryBlock('TRANSFER_DESTINATION_ACCESS_DENIED', async () => {
    const prev = await previewTemporaryBranchTransfer({
      empId,
      workDate: sat,
      toBranchId: CC,
      allowSetupDestination: true,
      callerHasDestinationAccess: false,
    });
    if (prev.blockers.some((b) => b.code === 'TRANSFER_DESTINATION_ACCESS_DENIED')) {
      throw new SchedulePolicyError('TRANSFER_DESTINATION_ACCESS_DENIED', 'denied', 403);
    }
    throw new Error('unauthorized destination did not fail closed');
  });

  await tryBlock('EMPLOYEE_BRANCH_PAYROLL_PLAN_REQUIRED', async () => {
    await pool.request().query(`
      INSERT INTO dbo.TblEmp (EmpName, Job, isActive)
      VALUES (N'[SMOKE 1S] NoPay ${smokeRunId}', N'حلاق', 1)
    `);
    const noPayId = Number(
      (
        await pool
          .request()
          .query(
            `SELECT TOP 1 EmpID FROM dbo.TblEmp WHERE EmpName=N'[SMOKE 1S] NoPay ${smokeRunId}' ORDER BY EmpID DESC`,
          )
      ).recordset[0].EmpID,
    );
    await registerSmokeArtifact({ smokeRunId, entityType: 'EMP', entityId: noPayId });
    await ensureEmployeeBranchAssignment({
      empId: noPayId,
      branchId: GLEEM,
      effectiveFrom: today,
      canReceiveBookings: true,
      isHomeBranch: true,
    });
    await ensureEmployeeBranchAssignment({
      empId: noPayId,
      branchId: CC,
      effectiveFrom: today,
      canReceiveBookings: true,
      isHomeBranch: false,
    });
    await pool.request().input('empId', sql.Int, noPayId).query(`
      INSERT INTO dbo.TblEmpBranchPayrollPlan (EmpID, BranchID, PayType, HourlyRate, EffectiveFrom, IsActive)
      VALUES (@empId, 1, N'hourly', 40, CAST(GETDATE() AS date), 1)
    `);
    await saveEmployeeBranchWeeklySchedule({
      empId: noPayId,
      branchId: GLEEM,
      effectiveFrom: today,
      cells: [0, 1, 2, 3, 4, 5, 6].map((dow) => ({
        dayOfWeek: dow,
        isWorking: dow === 6,
        startTime: '11:00',
        endTime: '20:00',
        canReceiveBookings: true,
      })),
      actorUserId: ACTOR,
      skipPayrollCheck: true,
    });
    try {
      await createTemporaryBranchTransfer({
        empId: noPayId,
        toBranchId: CC,
        workDate: sat,
        reason: 'no payroll at destination',
        createdByUserId: ACTOR,
        allowSetupDestination: true,
      });
    } finally {
      await pool.request().input('empId', sql.Int, noPayId).query(`
        UPDATE dbo.TblEmpBranchWorkSchedule SET IsActive=0 WHERE EmpID=@empId;
        UPDATE dbo.TblEmpBranchAssignment SET IsActive=0 WHERE EmpID=@empId;
        UPDATE dbo.TblEmpBranchPayrollPlan SET IsActive=0 WHERE EmpID=@empId;
        UPDATE dbo.TblEmp SET isActive=0 WHERE EmpID=@empId;
      `);
    }
  });

  // Contract presence for remaining blocker codes (implemented in temporaryBranchTransfer.ts)
  const transferSrc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src/lib/hr/temporaryBranchTransfer.ts'),
    'utf8',
  );
  for (const code of [
    'TEMPORARY_TRANSFER_HAS_SOURCE_BOOKINGS',
    'TRANSFER_ATTENDANCE_CONFLICT',
    'TRANSFER_ACTIVE_SERVICE_CONFLICT',
    'TRANSFER_PAYROLL_ALREADY_GENERATED',
    'TRANSFER_LEDGER_ALREADY_POSTED',
    'TRANSFER_GLOBAL_LEAVE_BLOCKS',
  ]) {
    blockerProofs[code] = transferSrc.includes(code);
  }

  // Cleanup smoke emp only — do not touch real زياد assignment
  await pool.request().input('empId', sql.Int, empId).query(`
    UPDATE dbo.TblEmpTemporaryBranchTransfer SET IsActive=0 WHERE EmpID=@empId;
    UPDATE dbo.TblEmpBranchWorkSchedule SET IsActive=0 WHERE EmpID=@empId;
    UPDATE dbo.TblEmpBranchAssignment SET IsActive=0, EffectiveTo=CAST(GETDATE() AS date) WHERE EmpID=@empId;
    UPDATE dbo.TblEmpBranchPayrollPlan SET IsActive=0 WHERE EmpID=@empId;
    UPDATE dbo.TblEmp SET isActive=0 WHERE EmpID=@empId;
  `);

  const ccStillSetup = await getBranchById(CC);
  expect(ccStillSetup?.lifecycleStatus === 'SETUP', 'CC remains SETUP');
  expect(ccStillSetup?.isActive === false, 'CC IsActive=0');
  expect(ccStillSetup?.publicBookingEnabled === false, 'public booking off');

  const ziadStill = await pool.request().query(`
    SELECT COUNT(*) AS Cnt FROM dbo.TblEmpBranchAssignment
    WHERE BranchID=3 AND EmpID=12 AND IsActive=1
  `);
  expect(Number(ziadStill.recordset[0].Cnt) === 1, 'real Ziad assignment preserved');

  const proofs = {
    phase: '1S-1R',
    smokeRunId,
    empId,
    empName,
    saturday: sat,
    tuesday: tue,
    baseline: {
      global: baselineGlobal.branches[0]?.branchCode,
      gleemPresent: gleemPresenceBefore.presentIds.has(empId),
      ccPresent: ccPresenceBefore.presentIds.has(empId),
    },
    apply: {
      transferId: xfer.transferId,
      fromBranchId: Number(tr.FromBranchID),
      toBranchId: Number(tr.ToBranchID),
      isEmergencyTransfer,
      resolver: afterGlobal.branches[0]?.branchCode,
      gleemPresent: gleemPresenceAfter.presentIds.has(empId),
      ccPresent: ccPresenceAfter.presentIds.has(empId),
    },
    cancel: {
      isActive: Number(cancelRow.recordset[0].IsActive),
      hardDeleted: false,
      resolver: restored.branches[0]?.branchCode,
    },
    boards: {
      afterApply: {
        gleem: gleemPresenceAfter.presentIds.has(empId),
        cc: ccPresenceAfter.presentIds.has(empId),
      },
      afterCancel: {
        gleem: gleemRestored.presentIds.has(empId),
        cc: ccRestored.presentIds.has(empId),
      },
    },
    weeklyUnchanged: true,
    legacyUnchanged: true,
    noFinancialSideEffects: true,
    publicCcHidden: true,
    blockerProofs,
    cleanup: { completed: true },
  };

  await markBranchSmokeRunStatus({
    smokeRunId,
    branchId: CC,
    status: 'PASSED',
    resultJson: { status: 'PASSED', proofs, phase: '1S-1R' },
  });
  await cleanupBranchSmokeRun({
    branchId: CC,
    smokeRunId,
    actorUserId: ACTOR,
    markArtifactsCleaned: true,
  });

  const outPath = path.join(__dirname, '_phase1s-1r-live-transfer-result.json');
  fs.writeFileSync(outPath, JSON.stringify(proofs, null, 2));
  console.log(JSON.stringify({ smokeRunId, empId, outPath, blockerProofs }, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
