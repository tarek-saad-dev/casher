import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { requireBranchOperationAccess, isActiveBranchContext } from '@/lib/branch/context';
import { listUserValidBranchAccess } from '@/lib/branch/repository';
import { evaluateDailyPayrollReadiness } from '@/lib/hr/dailyPayrollReadiness.service';
import { listTenantHrBranches } from '@/lib/hr/hrTenantScope';
import { isLegacyHrAllScopeBranch, isLegacyHrPrimaryBranch } from '@/lib/hr/legacyHrBranchPolicy';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ATTENDANCE_BLOCKERS = new Set([
  'missing_check_in',
  'missing_check_out',
  'open_attendance_session',
  'invalid_work_hours',
  'attendance_disposition_missing',
]);

async function ensureManagerClosingStepTable() {
  const db = await getPool();
  await db.request().query(`
    IF OBJECT_ID(N'dbo.TblManagerClosingStep', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.TblManagerClosingStep (
        ID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        BranchID INT NOT NULL,
        WorkDate DATE NOT NULL,
        StepCode NVARCHAR(50) NOT NULL,
        CompletedByUserID INT NULL,
        CompletedAt DATETIME2 NOT NULL CONSTRAINT DF_TblManagerClosingStep_CompletedAt DEFAULT SYSUTCDATETIME(),
        Notes NVARCHAR(500) NULL,
        CONSTRAINT UQ_TblManagerClosingStep UNIQUE (BranchID, WorkDate, StepCode),
        CONSTRAINT FK_TblManagerClosingStep_Branch FOREIGN KEY (BranchID) REFERENCES dbo.TblBranch(BranchID)
      );
      CREATE INDEX IX_TblManagerClosingStep_Date ON dbo.TblManagerClosingStep(WorkDate, BranchID);
    END
  `);
}

export async function GET(request: NextRequest) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;

  try {
    const sessionBranch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(sessionBranch)) return sessionBranch;

    const workDate = (request.nextUrl.searchParams.get('workDate') || '').trim();
    if (!DATE_RE.test(workDate)) {
      return NextResponse.json({ error: 'workDate مطلوب بصيغة YYYY-MM-DD' }, { status: 400 });
    }

    const access = await listUserValidBranchAccess(sessionBranch.userId);
    const allowed = new Set(
      access
        .filter((a) => a.canOperate || a.canSwitch || a.canViewReports || a.isDefault)
        .map((a) => a.branchId),
    );
    allowed.add(sessionBranch.branchId);

    const db = await getPool();
    await ensureManagerClosingStepTable();

    const tenantBranches = await listTenantHrBranches(auth.tenantId, undefined, { includeInactive: true });
    const legacyPair = tenantBranches.filter((b) => isLegacyHrAllScopeBranch(b.branchCode));
    const branches = (legacyPair.length > 0 ? legacyPair : tenantBranches.filter((b) => b.isActive))
      .sort((a, b) =>
        Number(!isLegacyHrPrimaryBranch(a.branchCode)) - Number(!isLegacyHrPrimaryBranch(b.branchCode)) ||
        a.branchId - b.branchId,
      )
      .map((b) => ({ branchId: b.branchId, branchCode: b.branchCode, branchName: b.branchName }))
      .filter((b) => allowed.has(b.branchId));

    const results = [];
    for (const branch of branches) {
      const [readiness, treasuryResult, reviewResult] = await Promise.all([
        evaluateDailyPayrollReadiness({ branchId: branch.branchId, workDate }),
        db.request()
          .input('branchId', sql.Int, branch.branchId)
          .input('workDate', sql.Date, workDate)
          .query(`
            SELECT
              COUNT(r.ID) AS ReconCount
            FROM dbo.TblNewDay nd
            LEFT JOIN dbo.TblTreasuryCloseRecon r
              ON r.NewDay = nd.ID
            WHERE nd.BranchID = @branchId
              AND nd.NewDay = @workDate
          `),
        db.request()
          .input('branchId', sql.Int, branch.branchId)
          .input('workDate', sql.Date, workDate)
          .query(`
            SELECT TOP 1 CompletedAt, CompletedByUserID
            FROM dbo.TblManagerClosingStep
            WHERE BranchID = @branchId
              AND WorkDate = @workDate
              AND StepCode = N'PAYMENT_REVIEW'
          `),
      ]);

      const attendanceBlockers = readiness.blockers.filter((b) => ATTENDANCE_BLOCKERS.has(b.code));
      const payrollBlockers = readiness.blockers.filter((b) =>
        ['payroll_not_generated', 'salary_config_missing', 'payroll_ledger_missing'].includes(b.code),
      );
      const treasuryRow = treasuryResult.recordset[0] ?? {};
      const reviewRow = reviewResult.recordset[0] ?? null;

      results.push({
        ...branch,
        treasury: {
          closed: Number(treasuryRow.ReconCount ?? 0) > 0,
          reconciliationCount: Number(treasuryRow.ReconCount ?? 0),
          closedAt: null,
        },
        paymentReview: {
          completed: Boolean(reviewRow),
          completedAt: reviewRow?.CompletedAt ?? null,
          completedByUserId: reviewRow?.CompletedByUserID ?? null,
        },
        attendance: {
          complete: attendanceBlockers.length === 0,
          pendingCount: attendanceBlockers.length,
          pending: attendanceBlockers.map((b) => ({
            code: b.code,
            empId: b.empId,
            empName: b.empName,
            message: b.message,
          })),
        },
        payroll: {
          generated: readiness.summary.payrollRowCount > 0 && payrollBlockers.length === 0,
          closed: readiness.persistedState === 'CLOSED',
          payrollRowCount: readiness.summary.payrollRowCount,
          blockerCount: payrollBlockers.length,
          totalWage: readiness.summary.totalWage,
          persistedState: readiness.persistedState,
          recommendedState: readiness.recommendedState,
          readyToClose: readiness.readyToClose,
        },
      });
    }

    const treasuryComplete = results.length > 0 && results.every((b) => b.treasury.closed);
    const paymentReviewComplete = results.length > 0 && results.every((b) => b.paymentReview.completed);
    const attendanceComplete = results.length > 0 && results.every((b) => b.attendance.complete);
    const payrollComplete = results.length > 0 && results.every((b) => b.payroll.generated);

    return NextResponse.json({
      workDate,
      branches: results,
      steps: {
        treasury: { complete: treasuryComplete },
        paymentReview: { complete: paymentReviewComplete },
        attendance: {
          complete: attendanceComplete,
          pendingCount: results.reduce((sum, b) => sum + b.attendance.pendingCount, 0),
        },
        payroll: {
          complete: payrollComplete,
          generatedCount: results.reduce((sum, b) => sum + b.payroll.payrollRowCount, 0),
        },
      },
      complete: treasuryComplete && paymentReviewComplete && attendanceComplete && payrollComplete,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[api/admin/manager-closing/status] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
