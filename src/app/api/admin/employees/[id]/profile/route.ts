import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";

async function ensureScheduleTable(db: any) {
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

function formatTime(val: any): string | null {
  if (!val) return null;
  if (typeof val === 'string') return val.substring(0, 5);
  if (val instanceof Date) {
    const h = String(val.getHours()).padStart(2, '0');
    const m = String(val.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
  return null;
}

function formatScheduleRow(row: any) {
  return {
    ...row,
    StartTime: formatTime(row.StartTime),
    EndTime: formatTime(row.EndTime),
    BreakStartTime: formatTime(row.BreakStartTime),
    BreakEndTime: formatTime(row.BreakEndTime),
  };
}

// GET /api/admin/employees/:id/profile - Get employee complete profile
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const { id } = await params;
    const empId = parseInt(id);
    if (isNaN(empId)) {
      return NextResponse.json({ error: "معرف الموظف غير صحيح" }, { status: 400 });
    }

    const db = await getPool();

    // Get employee basic info - handle missing columns gracefully
    const empResult = await db.request()
      .input("empId", sql.Int, empId)
      .query(`
        SELECT 
          EmpID, EmpName, Job, Mobile, CardNO, Notes,
          CASE 
            WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'NationalID') 
            THEN NationalID ELSE NULL 
          END AS NationalID,
          CASE 
            WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'Address') 
            THEN Address ELSE NULL 
          END AS Address,
          CASE 
            WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'EmergencyContactName') 
            THEN EmergencyContactName ELSE NULL 
          END AS EmergencyContactName,
          CASE 
            WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'EmergencyContactPhone') 
            THEN EmergencyContactPhone ELSE NULL 
          END AS EmergencyContactPhone,
          CASE 
            WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'BirthDate') 
            THEN BirthDate ELSE NULL 
          END AS BirthDate,
          CASE 
            WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'HireDate') 
            THEN HireDate ELSE NULL 
          END AS HireDate,
          CASE 
            WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'PersonalNotes') 
            THEN PersonalNotes ELSE NULL 
          END AS PersonalNotes,
          BaseSalary, TargetCommissionPercent, TargetMinSales,
          CONVERT(VARCHAR(5), DefaultCheckInTime, 108) AS DefaultCheckInTime,
          CONVERT(VARCHAR(5), DefaultCheckOutTime, 108) AS DefaultCheckOutTime,
          IsPayrollEnabled,
          isActive
        FROM dbo.TblEmp 
        WHERE EmpID = @empId
      `);

    if (empResult.recordset.length === 0) {
      return NextResponse.json({ error: "الموظف غير موجود" }, { status: 404 });
    }

    const employee = empResult.recordset[0];

    // Ensure schedule table exists
    await ensureScheduleTable(db);

    // Get work schedule
    let schedule: any[] = [];
    try {
      const scheduleResult = await db.request()
        .input("empId", sql.Int, empId)
        .query(`
          SELECT 
            DayOfWeek,
            IsWorkingDay,
            StartTime,
            EndTime,
            BreakStartTime,
            BreakEndTime,
            Notes
          FROM dbo.TblEmpWorkSchedule 
          WHERE EmpID = @empId
          ORDER BY DayOfWeek
        `);

      schedule = scheduleResult.recordset;
    } catch (scheduleError) {
      console.log('TblEmpWorkSchedule error:', scheduleError);
      schedule = [];
    }

    // Get days off (last 90 days by default) - handle missing table gracefully
    let daysOff: any[] = [];
    try {
      const daysOffResult = await db.request()
        .input("empId", sql.Int, empId)
        .input("fromDate", sql.Date, new Date(Date.now() - 90 * 24 * 60 * 60 * 1000))
        .query(`
          SELECT 
            ID,
            OffDate,
            OffType,
            Reason,
            IsPaid,
            CreatedAt,
            UpdatedAt
          FROM dbo.TblEmpDayOff 
          WHERE EmpID = @empId 
            AND IsDeleted = 0
            AND OffDate >= @fromDate
          ORDER BY OffDate DESC
        `);

      daysOff = daysOffResult.recordset;
    } catch (daysOffError) {
      // Table doesn't exist, return empty days off
      console.log('TblEmpDayOff table not found, using empty days off');
      daysOff = [];
    }

    return NextResponse.json({
      success: true,
      employee,
      schedule: schedule.map(formatScheduleRow),
      daysOff
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/admin/employees/[id]/profile] GET error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH /api/admin/employees/:id/profile - Update employee personal info
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const { id } = await params;
    const empId = parseInt(id);
    if (isNaN(empId)) {
      return NextResponse.json({ error: "معرف الموظف غير صحيح" }, { status: 400 });
    }

    const body = await req.json();
    const {
      EmpName,
      Job,
      Mobile,
      CardNO,
      Notes,
      NationalID,
      Address,
      EmergencyContactName,
      EmergencyContactPhone,
      BirthDate,
      HireDate,
      PersonalNotes,
      BaseSalary,
      TargetCommissionPercent,
      TargetMinSales,
      IsPayrollEnabled
    } = body;

    // Validation
    if (!EmpName || String(EmpName).trim().length === 0) {
      return NextResponse.json({ error: "اسم الموظف مطلوب" }, { status: 400 });
    }

    const db = await getPool();
    const transaction = new sql.Transaction(db);
    await transaction.begin();

    try {
      // Check if employee exists
      const empCheck = await new sql.Request(transaction)
        .input("empId", sql.Int, empId)
        .query("SELECT EmpID FROM dbo.TblEmp WHERE EmpID = @empId");

      if (empCheck.recordset.length === 0) {
        await transaction.rollback();
        return NextResponse.json({ error: "الموظف غير موجود" }, { status: 404 });
      }

      // Update employee personal info - handle missing columns gracefully
      const updateFields = [];
      const request = new sql.Request(transaction);

      if (EmpName !== undefined) {
        updateFields.push("EmpName = @empName");
        request.input("empName", sql.NVarChar(200), String(EmpName).trim());
      }
      if (Job !== undefined) {
        updateFields.push("Job = @job");
        request.input("job", sql.NVarChar(100), Job);
      }
      if (Mobile !== undefined) {
        updateFields.push("Mobile = @mobile");
        request.input("mobile", sql.NVarChar(30), Mobile);
      }
      if (CardNO !== undefined) {
        updateFields.push("CardNO = @cardNO");
        request.input("cardNO", sql.NVarChar(50), CardNO);
      }
      if (Notes !== undefined) {
        updateFields.push("Notes = @notes");
        request.input("notes", sql.NVarChar(500), Notes);
      }
      
      // Check if columns exist before adding them to update
      const columnsCheck = await new sql.Request(transaction).query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'TblEmp' 
          AND COLUMN_NAME IN ('NationalID', 'Address', 'EmergencyContactName', 'EmergencyContactPhone', 'BirthDate', 'HireDate', 'PersonalNotes', 'ModifiedDate', 'BaseSalary', 'TargetCommissionPercent', 'TargetMinSales', 'IsPayrollEnabled')
      `);
      
      const existingColumns = columnsCheck.recordset.map(r => r.COLUMN_NAME);
      
      if (NationalID !== undefined && existingColumns.includes('NationalID')) {
        updateFields.push("NationalID = @nationalID");
        request.input("nationalID", sql.NVarChar(50), NationalID);
      }
      if (Address !== undefined && existingColumns.includes('Address')) {
        updateFields.push("Address = @address");
        request.input("address", sql.NVarChar(250), Address);
      }
      if (EmergencyContactName !== undefined && existingColumns.includes('EmergencyContactName')) {
        updateFields.push("EmergencyContactName = @emergencyContactName");
        request.input("emergencyContactName", sql.NVarChar(100), EmergencyContactName);
      }
      if (EmergencyContactPhone !== undefined && existingColumns.includes('EmergencyContactPhone')) {
        updateFields.push("EmergencyContactPhone = @emergencyContactPhone");
        request.input("emergencyContactPhone", sql.NVarChar(30), EmergencyContactPhone);
      }
      if (BirthDate !== undefined && existingColumns.includes('BirthDate')) {
        updateFields.push("BirthDate = @birthDate");
        request.input("birthDate", sql.Date, BirthDate);
      }
      if (HireDate !== undefined && existingColumns.includes('HireDate')) {
        updateFields.push("HireDate = @hireDate");
        request.input("hireDate", sql.Date, HireDate);
      }
      if (PersonalNotes !== undefined && existingColumns.includes('PersonalNotes')) {
        updateFields.push("PersonalNotes = @personalNotes");
        request.input("personalNotes", sql.NVarChar(500), PersonalNotes);
      }
      if (BaseSalary !== undefined) {
        updateFields.push("BaseSalary = @baseSalary");
        request.input("baseSalary", sql.Decimal(18, 2), BaseSalary !== null && BaseSalary !== '' ? parseFloat(BaseSalary) : null);
      }
      if (TargetCommissionPercent !== undefined) {
        updateFields.push("TargetCommissionPercent = @targetCommissionPercent");
        request.input("targetCommissionPercent", sql.Decimal(5, 2), TargetCommissionPercent !== null && TargetCommissionPercent !== '' ? parseFloat(TargetCommissionPercent) : null);
      }
      if (TargetMinSales !== undefined) {
        updateFields.push("TargetMinSales = @targetMinSales");
        request.input("targetMinSales", sql.Decimal(18, 2), TargetMinSales !== null && TargetMinSales !== '' ? parseFloat(TargetMinSales) : null);
      }
      if (IsPayrollEnabled !== undefined) {
        updateFields.push("IsPayrollEnabled = @isPayrollEnabled");
        request.input("isPayrollEnabled", sql.Bit, IsPayrollEnabled ? 1 : 0);
      }

      if (updateFields.length > 0) {
        // Only add ModifiedDate if the column exists
        if (existingColumns.includes('ModifiedDate')) {
          updateFields.push("ModifiedDate = GETDATE()");
        }
        
        const updateQuery = `
          UPDATE dbo.TblEmp 
          SET ${updateFields.join(", ")}
          WHERE EmpID = @empId
        `;
        
        request.input("empId", sql.Int, empId);
        await request.query(updateQuery);
      }

      await transaction.commit();

      // Get updated employee data - handle missing columns gracefully
      const updatedResult = await db.request()
        .input("empId", sql.Int, empId)
        .query(`
          SELECT 
            EmpID, EmpName, Job, Mobile, CardNO, Notes,
            CASE 
              WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'NationalID') 
              THEN NationalID ELSE NULL 
            END AS NationalID,
            CASE 
              WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'Address') 
              THEN Address ELSE NULL 
            END AS Address,
            CASE 
              WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'EmergencyContactName') 
              THEN EmergencyContactName ELSE NULL 
            END AS EmergencyContactName,
            CASE 
              WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'EmergencyContactPhone') 
              THEN EmergencyContactPhone ELSE NULL 
            END AS EmergencyContactPhone,
            CASE 
              WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'BirthDate') 
              THEN BirthDate ELSE NULL 
            END AS BirthDate,
            CASE 
              WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'HireDate') 
              THEN HireDate ELSE NULL 
            END AS HireDate,
            CASE 
              WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'PersonalNotes') 
              THEN PersonalNotes ELSE NULL 
            END AS PersonalNotes,
            BaseSalary, TargetCommissionPercent, TargetMinSales,
            CONVERT(VARCHAR(5), DefaultCheckInTime, 108) AS DefaultCheckInTime,
            CONVERT(VARCHAR(5), DefaultCheckOutTime, 108) AS DefaultCheckOutTime,
            IsPayrollEnabled,
            isActive
          FROM dbo.TblEmp 
          WHERE EmpID = @empId
        `);

      return NextResponse.json({
        success: true,
        message: "تم تحديث بيانات الموظف بنجاح",
        employee: updatedResult.recordset[0]
      });

    } catch (innerErr) {
      await transaction.rollback();
      throw innerErr;
    }

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/admin/employees/[id]/profile] PATCH error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
