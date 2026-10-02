import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { requireBranchOperationAccess, isActiveBranchContext } from '@/lib/branch/context';
import { listUserValidBranchAccess } from '@/lib/branch/repository';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

export async function POST(request: NextRequest) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;

  try {
    const sessionBranch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(sessionBranch)) return sessionBranch;

    const body = await request.json().catch(() => ({}));
    const branchId = Number(body.branchId);
    const workDate = String(body.workDate ?? '').trim();
    const notes = body.notes ? String(body.notes).slice(0, 500) : null;

    if (!Number.isFinite(branchId) || branchId <= 0 || !DATE_RE.test(workDate)) {
      return NextResponse.json({ error: 'branchId و workDate مطلوبان' }, { status: 400 });
    }

    const access = await listUserValidBranchAccess(sessionBranch.userId);
    const allowed = new Set(
      access
        .filter((a) => a.canOperate || a.canSwitch || a.canViewReports || a.isDefault)
        .map((a) => a.branchId),
    );
    allowed.add(sessionBranch.branchId);
    if (!allowed.has(branchId)) {
      return NextResponse.json({ error: 'غير مصرح بالوصول لهذا الفرع' }, { status: 403 });
    }

    const db = await getPool();
    await ensureManagerClosingStepTable();

    await db.request()
      .input('branchId', sql.Int, branchId)
      .input('workDate', sql.Date, workDate)
      .input('userId', sql.Int, auth.userId)
      .input('notes', sql.NVarChar(500), notes)
      .query(`
        MERGE dbo.TblManagerClosingStep AS target
        USING (
          SELECT @branchId AS BranchID, @workDate AS WorkDate, N'PAYMENT_REVIEW' AS StepCode
        ) AS source
        ON target.BranchID = source.BranchID
          AND target.WorkDate = source.WorkDate
          AND target.StepCode = source.StepCode
        WHEN MATCHED THEN
          UPDATE SET CompletedByUserID = @userId, CompletedAt = SYSUTCDATETIME(), Notes = @notes
        WHEN NOT MATCHED THEN
          INSERT (BranchID, WorkDate, StepCode, CompletedByUserID, Notes)
          VALUES (@branchId, @workDate, N'PAYMENT_REVIEW', @userId, @notes);
      `);

    return NextResponse.json({ success: true, branchId, workDate });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[api/admin/manager-closing/payment-review] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
