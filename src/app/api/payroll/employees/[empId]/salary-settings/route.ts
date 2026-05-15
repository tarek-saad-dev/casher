import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';

type Ctx = { params: Promise<{ empId: string }> };

// Sanitize time to "HH:mm:ss" or null.
// Accepts: null/undefined/empty, "HH:mm", "HH:mm:ss", ISO "1970-01-01T12:00:00.000Z"
function sanitizeTime(value: unknown): string | null {
  if (value == null) return null;

  const raw = String(value).trim();
  if (!raw || raw.includes('--')) return null;

  // ISO date string (e.g. from browser time input serialised as Date)
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  // HH:mm or HH:mm:ss
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;

  const h = Number(match[1]);
  const m = Number(match[2]);
  const s = match[3] ? Number(match[3]) : 0;

  if (h < 0 || h > 23 || m < 0 || m > 59 || s < 0 || s > 59) return null;

  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// PUT /api/payroll/employees/[empId]/salary-settings
// Body: { dailyWage, isPayrollEnabled, defaultCheckInTime, defaultCheckOutTime, workScheduleNotes }
export async function PUT(req: NextRequest, { params }: Ctx) {
  let step = 'init';
  let empID = 0;
  let wage  = 0;

  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

    const { empId } = await params;
    empID = parseInt(empId);
    if (isNaN(empID)) {
      return NextResponse.json({ error: 'معرف الموظف غير صالح' }, { status: 400 });
    }

    const body = await req.json();
    const {
      dailyWage,
      isPayrollEnabled,
      defaultCheckInTime: rawCheckIn,
      defaultCheckOutTime: rawCheckOut,
      workScheduleNotes,
    } = body;

    // ── Sanitize time inputs before touching SQL ──────────────────────────────
    const checkIn  = sanitizeTime(rawCheckIn);
    const checkOut = sanitizeTime(rawCheckOut);

    // ── Validation ────────────────────────────────────────────────────────────
    wage = Number(dailyWage);
    if (isNaN(wage) || wage < 0) {
      return NextResponse.json({ error: 'اليومية يجب أن تكون رقمًا موجبًا أو صفر' }, { status: 400 });
    }
    if (isPayrollEnabled && wage <= 0) {
      return NextResponse.json({ error: 'يجب تحديد اليومية عند تفعيل نظام الرواتب' }, { status: 400 });
    }

    console.log(`[salary-settings] empID=${empID} wage=${wage} payrollEnabled=${isPayrollEnabled} checkIn=${checkIn} checkOut=${checkOut}`);

    const db = await getPool();

    // ── Pre-check: employee exists (outside transaction) ──────────────────────
    step = 'emp-exists-check';
    const empCheck = await db.request()
      .input('EmpID', sql.Int, empID)
      .query(`SELECT EmpID, EmpName FROM dbo.TblEmp WHERE EmpID = @EmpID`);
    if (empCheck.recordset.length === 0) {
      return NextResponse.json({ error: 'الموظف غير موجود' }, { status: 404 });
    }

    // ── Fetch active salary history (outside transaction, read-only) ──────────
    step = 'fetch-active-history';
    const histResult = await db.request()
      .input('EmpID', sql.Int, empID)
      .query(`
        SELECT ID, SalaryAmount
        FROM dbo.TblEmpSalaryHistory
        WHERE EmpID = @EmpID AND IsActive = 1 AND EffectiveTo IS NULL
      `);
    const activeHistory = histResult.recordset[0] as
      | { ID: number; SalaryAmount: number | string }
      | undefined;

    // Normalize SalaryAmount to number for comparison (mssql may return Decimal as string)
    const existingWage = activeHistory
      ? parseFloat(String(activeHistory.SalaryAmount))
      : null;
    const wageChanged = existingWage === null || Math.abs(existingWage - wage) > 0.001;

    // ── Atomic transaction ────────────────────────────────────────────────────
    const transaction = new sql.Transaction(db);
    step = 'transaction-begin';
    await transaction.begin();

    try {
      // Step 1: Update TblEmp
      step = 'update-TblEmp';
      const empReq = new sql.Request(transaction);
      empReq.input('EmpID',            sql.Int,           empID);
      empReq.input('DailyWage',        sql.Decimal(10,2), wage);
      empReq.input('IsPayrollEnabled', sql.Bit,           isPayrollEnabled ? 1 : 0);
      empReq.input('CheckIn',          sql.VarChar(8),    checkIn);
      empReq.input('CheckOut',         sql.VarChar(8),    checkOut);
      empReq.input('ScheduleNotes',    sql.NVarChar(250), workScheduleNotes ?? null);

      await empReq.query(`
        UPDATE dbo.TblEmp
        SET
          Salary              = @DailyWage,
          BaseSalary          = @DailyWage,
          SalaryType          = N'Daily',
          IsPayrollEnabled    = @IsPayrollEnabled,
          DefaultCheckInTime  = CASE WHEN @CheckIn  IS NULL THEN NULL ELSE CONVERT(time, @CheckIn)  END,
          DefaultCheckOutTime = CASE WHEN @CheckOut IS NULL THEN NULL ELSE CONVERT(time, @CheckOut) END,
          WorkScheduleNotes   = @ScheduleNotes
        WHERE EmpID = @EmpID
      `);

      // SELECT after UPDATE — avoids OUTPUT INSERTED conflict with trigger
      const selReq = new sql.Request(transaction);
      const selResult = await selReq
        .input('EmpID', sql.Int, empID)
        .query(`
          SELECT
            EmpID,
            EmpName,
            Salary,
            BaseSalary,
            SalaryType,
            IsPayrollEnabled,
            CAST(DefaultCheckInTime  AS varchar(8)) AS DefaultCheckInTime,
            CAST(DefaultCheckOutTime AS varchar(8)) AS DefaultCheckOutTime,
            WorkScheduleNotes,
            HourlyRate
          FROM dbo.TblEmp
          WHERE EmpID = @EmpID
        `);

      const updatedEmp = selResult.recordset[0];

      // Step 2: Salary history
      let activeHistoryAfter: Record<string, unknown> | null = null;

      if (!activeHistory) {
        // No active row → insert new
        step = 'insert-new-history';
        const insReq = new sql.Request(transaction);
        const insResult = await insReq
          .input('EmpID',        sql.Int,           empID)
          .input('SalaryAmount', sql.Decimal(10,2), wage)
          .query(`
            INSERT INTO dbo.TblEmpSalaryHistory
              (EmpID, SalaryType, SalaryAmount, EffectiveFrom, EffectiveTo, IsActive, Notes, CreatedAt)
            OUTPUT
              INSERTED.ID, INSERTED.EmpID, INSERTED.SalaryType,
              INSERTED.SalaryAmount, INSERTED.EffectiveFrom, INSERTED.EffectiveTo,
              INSERTED.IsActive, INSERTED.Notes, INSERTED.CreatedAt
            VALUES
              (@EmpID, N'Daily', @SalaryAmount, CAST(GETDATE() AS DATE), NULL, 1,
               N'Created from salaries page', GETDATE())
          `);
        activeHistoryAfter = insResult.recordset[0];

      } else if (wageChanged) {
        // Wage changed → close old row
        step = 'close-old-history';
        const closeReq = new sql.Request(transaction);
        await closeReq
          .input('HistID', sql.Int, activeHistory.ID)
          .query(`
            UPDATE dbo.TblEmpSalaryHistory
            SET
              IsActive    = 0,
              EffectiveTo = DATEADD(DAY, -1, CAST(GETDATE() AS DATE)),
              Notes       = ISNULL(Notes, N'') + N' | Closed by salaries page update'
            WHERE ID = @HistID
          `);

        // Insert new active row
        step = 'insert-updated-history';
        const insReq2 = new sql.Request(transaction);
        const insResult2 = await insReq2
          .input('EmpID',        sql.Int,           empID)
          .input('SalaryAmount', sql.Decimal(10,2), wage)
          .query(`
            INSERT INTO dbo.TblEmpSalaryHistory
              (EmpID, SalaryType, SalaryAmount, EffectiveFrom, EffectiveTo, IsActive, Notes, CreatedAt)
            OUTPUT
              INSERTED.ID, INSERTED.EmpID, INSERTED.SalaryType,
              INSERTED.SalaryAmount, INSERTED.EffectiveFrom, INSERTED.EffectiveTo,
              INSERTED.IsActive, INSERTED.Notes, INSERTED.CreatedAt
            VALUES
              (@EmpID, N'Daily', @SalaryAmount, CAST(GETDATE() AS DATE), NULL, 1,
               N'Updated from salaries page', GETDATE())
          `);
        activeHistoryAfter = insResult2.recordset[0];

      } else {
        // Same wage → no history change needed
        step = 'history-unchanged';
        activeHistoryAfter = {
          ID:           activeHistory.ID,
          SalaryAmount: existingWage,
        };
      }

      step = 'commit';
      await transaction.commit();

      return NextResponse.json({
        success:       true,
        employee:      updatedEmp,
        salaryHistory: activeHistoryAfter,
      });

    } catch (txErr) {
      const txMsg = txErr instanceof Error ? txErr.message : String(txErr);
      console.error(`[salary-settings] FAILED at step="${step}" empID=${empID} wage=${wage} — ${txMsg}`);
      try { await transaction.rollback(); } catch { /* already rolled back */ }
      throw txErr;
    }

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[salary-settings] PUT error step="${step}" empID=${empID} wage=${wage}: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
