/**
 * DB helpers for Employee HR model writes (Phase 2).
 */

import { sql } from '@/lib/db';
import type { HrDbColumnValues } from '@/lib/hr/employee-hr-model';
import type { ScheduleRowWrite } from '@/lib/hr/employee-hr-schedule';

export function timeToSqlDate(timeStr: string | null | undefined): Date | null {
  if (!timeStr || timeStr.trim() === '') return null;
  const parts = timeStr.split(':').map(Number);
  const d = new Date(0);
  d.setUTCHours(parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, 0);
  return d;
}

export async function ensureScheduleTable(db: { request: () => sql.Request }): Promise<void> {
  await db.request().query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TblEmpWorkSchedule')
    BEGIN
        CREATE TABLE dbo.TblEmpWorkSchedule (
            ID INT IDENTITY(1,1) PRIMARY KEY,
            EmpID INT NOT NULL,
            DayOfWeek TINYINT NOT NULL,
            IsWorkingDay BIT NOT NULL DEFAULT 1,
            StartTime TIME NULL,
            EndTime TIME NULL,
            BreakStartTime TIME NULL,
            BreakEndTime TIME NULL,
            Notes NVARCHAR(200) NULL,
            CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
            UpdatedAt DATETIME NULL,
            CONSTRAINT CK_TblEmpWorkSchedule_DayOfWeek CHECK (DayOfWeek BETWEEN 0 AND 6)
        );

        ALTER TABLE dbo.TblEmpWorkSchedule
        ADD CONSTRAINT FK_TblEmpWorkSchedule_TblEmp
        FOREIGN KEY (EmpID) REFERENCES dbo.TblEmp(EmpID);

        CREATE UNIQUE INDEX UQ_TblEmpWorkSchedule_Emp_Day
        ON dbo.TblEmpWorkSchedule (EmpID, DayOfWeek);

        CREATE INDEX IX_TblEmpWorkSchedule_EmpID
        ON dbo.TblEmpWorkSchedule (EmpID);
    END
  `);
}

export async function upsertEmployeeSchedule(
  transaction: sql.Transaction,
  empId: number,
  rows: ScheduleRowWrite[],
): Promise<void> {
  for (const day of rows) {
    const req = new sql.Request(transaction);
    const existing = await req
      .input('empId', sql.Int, empId)
      .input('dayOfWeek', sql.TinyInt, day.dayOfWeek)
      .query(`
        SELECT ID FROM dbo.TblEmpWorkSchedule
        WHERE EmpID = @empId AND DayOfWeek = @dayOfWeek
      `);

    const writeReq = new sql.Request(transaction);
    writeReq
      .input('empId', sql.Int, empId)
      .input('dayOfWeek', sql.TinyInt, day.dayOfWeek)
      .input('isWorkingDay', sql.Bit, day.isWorkingDay ? 1 : 0)
      .input('startTime', sql.Time, day.isWorkingDay ? timeToSqlDate(day.startTime) : null)
      .input('endTime', sql.Time, day.isWorkingDay ? timeToSqlDate(day.endTime) : null)
      .input('breakStartTime', sql.Time, timeToSqlDate(day.breakStartTime))
      .input('breakEndTime', sql.Time, timeToSqlDate(day.breakEndTime))
      .input('notes', sql.NVarChar(200), day.notes);

    if (existing.recordset.length > 0) {
      writeReq.input('scheduleId', sql.Int, existing.recordset[0].ID);
      await writeReq.query(`
        UPDATE dbo.TblEmpWorkSchedule
        SET IsWorkingDay = @isWorkingDay,
            StartTime = @startTime,
            EndTime = @endTime,
            BreakStartTime = @breakStartTime,
            BreakEndTime = @breakEndTime,
            Notes = @notes,
            UpdatedAt = GETDATE()
        WHERE ID = @scheduleId
      `);
    } else {
      await writeReq.query(`
        INSERT INTO dbo.TblEmpWorkSchedule
          (EmpID, DayOfWeek, IsWorkingDay, StartTime, EndTime, BreakStartTime, BreakEndTime, Notes, CreatedAt)
        VALUES
          (@empId, @dayOfWeek, @isWorkingDay, @startTime, @endTime, @breakStartTime, @breakEndTime, @notes, GETDATE())
      `);
    }
  }
}

/** Builds INSERT column list + inputs for HR-mode employee create. */
export function buildHrInsertQuery(
  empName: string,
  isActive: boolean,
  cols: HrDbColumnValues,
): { sql: string; bind: (req: sql.Request) => void } {
  const bind = (req: sql.Request) => {
    req.input('empName', sql.NVarChar(200), empName);
    req.input('isActive', sql.Bit, isActive ? 1 : 0);
    req.input('employmentType', sql.NVarChar(20), cols.EmploymentType);
    req.input('payrollMethod', sql.NVarChar(20), cols.PayrollMethod);
    req.input('dayOffPolicy', sql.NVarChar(20), cols.DayOffPolicy);
    req.input('isPayrollEnabled', sql.Bit, cols.IsPayrollEnabled);
    req.input('isAttendanceExempt', sql.Bit, cols.IsAttendanceExempt);
    req.input('checkIn', sql.VarChar(8), cols.DefaultCheckInTime);
    req.input('checkOut', sql.VarChar(8), cols.DefaultCheckOutTime);
    req.input('hireDate', sql.Date, cols.HireDate);
    req.input('manualHourlyRate', sql.Decimal(10, 4), cols.ManualHourlyRate);
    req.input('dailyRate', sql.Decimal(10, 2), cols.DailyRate);
    req.input('baseSalary', sql.Decimal(10, 2), cols.BaseSalary);
    req.input('salary', sql.Decimal(10, 2), cols.Salary);
    req.input('salaryType', sql.NVarChar(20), cols.SalaryType);
  };

  const sqlText = `
    INSERT INTO dbo.TblEmp (
      EmpName, isActive,
      EmploymentType, PayrollMethod, DayOffPolicy, IsPayrollEnabled, IsAttendanceExempt,
      DefaultCheckInTime, DefaultCheckOutTime, HireDate,
      ManualHourlyRate, DailyRate, BaseSalary, Salary, SalaryType
    )
    VALUES (
      @empName, @isActive,
      @employmentType, @payrollMethod, @dayOffPolicy, @isPayrollEnabled, @isAttendanceExempt,
      CASE WHEN @checkIn  IS NULL THEN NULL ELSE CONVERT(time, @checkIn)  END,
      CASE WHEN @checkOut IS NULL THEN NULL ELSE CONVERT(time, @checkOut) END,
      @hireDate,
      @manualHourlyRate, @dailyRate, @baseSalary, @salary, @salaryType
    );

    SELECT EmpID, EmpName, isActive
    FROM dbo.TblEmp
    WHERE EmpID = SCOPE_IDENTITY();
  `;

  return { sql: sqlText, bind };
}

export const EMPLOYEE_LIST_SELECT = `
  SELECT
    e.EmpID, e.EmpName, e.Job, e.isActive,
    e.BaseSalary, e.Salary, e.SalaryType,
    e.TargetCommissionPercent, e.TargetMinSales,
    CONVERT(VARCHAR(5), e.DefaultCheckInTime,  108) AS DefaultCheckInTime,
    CONVERT(VARCHAR(5), e.DefaultCheckOutTime, 108) AS DefaultCheckOutTime,
    e.HireDate,
    e.EmploymentType, e.PayrollMethod, e.DayOffPolicy, e.DailyRate, e.ManualHourlyRate,
    e.IsPayrollEnabled,
    e.IsAttendanceExempt,
    e.HourlyRate,
    CASE
      WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'WorkScheduleNotes')
      THEN e.WorkScheduleNotes ELSE NULL
    END AS WorkScheduleNotes,
    CASE
      WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'WhatsApp')
      THEN e.WhatsApp ELSE NULL
    END AS WhatsApp,
    e.Mobile,
    adv.ExpINID AS AdvanceExpINID, adv.CatName AS AdvanceCatName,
    rev.ExpINID AS RevenueExpINID, rev.CatName AS RevenueCatName
  FROM dbo.TblEmp e
  OUTER APPLY (
    SELECT TOP 1 m.ExpINID, cat.CatName
    FROM dbo.TblExpCatEmpMap m
    JOIN dbo.TblExpINCat cat ON cat.ExpINID = m.ExpINID
    WHERE m.EmpID = e.EmpID AND m.TxnKind = N'advance' AND m.IsActive = 1
      AND cat.ExpINType = N'مصروفات'
    ORDER BY m.ModifiedDate DESC, m.ID DESC
  ) adv
  OUTER APPLY (
    SELECT TOP 1 m.ExpINID, cat.CatName
    FROM dbo.TblExpCatEmpMap m
    JOIN dbo.TblExpINCat cat ON cat.ExpINID = m.ExpINID
    WHERE m.EmpID = e.EmpID AND m.TxnKind = N'revenue' AND m.IsActive = 1
      AND cat.ExpINType = N'ايرادات'
    ORDER BY m.ModifiedDate DESC, m.ID DESC
  ) rev
`;

export const EMPLOYEE_SELECT_BY_ID = `
  SELECT
    EmpID, EmpName, isActive, BaseSalary, Salary, SalaryType,
    TargetCommissionPercent, TargetMinSales,
    CAST(DefaultCheckInTime  AS varchar(8)) AS DefaultCheckInTime,
    CAST(DefaultCheckOutTime AS varchar(8)) AS DefaultCheckOutTime,
    HireDate,
    EmploymentType, PayrollMethod, DayOffPolicy, DailyRate, ManualHourlyRate,
    IsPayrollEnabled, IsAttendanceExempt, HourlyRate,
    CASE
      WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'WhatsApp')
      THEN WhatsApp ELSE NULL
    END AS WhatsApp,
    Mobile
  FROM dbo.TblEmp
  WHERE EmpID = @empID
`;
