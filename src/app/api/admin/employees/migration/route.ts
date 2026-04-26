import { NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";

export async function POST() {
  try {
    const db = await getPool();
    const migrationResults = [];

    // Add PersonalNotes column if it doesn't exist
    const personalNotesResult = await db.request().query(`
      IF NOT EXISTS (
          SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'PersonalNotes'
      )
      BEGIN
          ALTER TABLE dbo.TblEmp ADD PersonalNotes NVARCHAR(500) NULL;
          SELECT 1 as Success, 'PersonalNotes column added' as Message;
      END
      ELSE
      BEGIN
          SELECT 1 as Success, 'PersonalNotes column already exists' as Message;
      END
    `);
    migrationResults.push(personalNotesResult.recordset[0]);

    // Add other missing columns if needed
    await db.request().query(`
      -- NationalID
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'NationalID')
      BEGIN
          ALTER TABLE dbo.TblEmp ADD NationalID NVARCHAR(50) NULL;
          PRINT N'Added NationalID column';
      END

      -- Address
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'Address')
      BEGIN
          ALTER TABLE dbo.TblEmp ADD Address NVARCHAR(250) NULL;
          PRINT N'Added Address column';
      END

      -- EmergencyContactName
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'EmergencyContactName')
      BEGIN
          ALTER TABLE dbo.TblEmp ADD EmergencyContactName NVARCHAR(100) NULL;
          PRINT N'Added EmergencyContactName column';
      END

      -- EmergencyContactPhone
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'EmergencyContactPhone')
      BEGIN
          ALTER TABLE dbo.TblEmp ADD EmergencyContactPhone NVARCHAR(30) NULL;
          PRINT N'Added EmergencyContactPhone column';
      END

      -- BirthDate
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'BirthDate')
      BEGIN
          ALTER TABLE dbo.TblEmp ADD BirthDate DATE NULL;
          PRINT N'Added BirthDate column';
      END

      -- HireDate
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'HireDate')
      BEGIN
          ALTER TABLE dbo.TblEmp ADD HireDate DATE NULL;
          PRINT N'Added HireDate column';
      END
    `);

    // Create TblEmpWorkSchedule table if it doesn't exist
    const scheduleResult = await db.request().query(`
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
          
          SELECT 1 as Success, 'TblEmpWorkSchedule table created' as Message;
      END
      ELSE
      BEGIN
          SELECT 1 as Success, 'TblEmpWorkSchedule table already exists' as Message;
      END
    `);
    migrationResults.push(scheduleResult.recordset[0]);

    // Create TblEmpDayOff table if it doesn't exist
    const dayOffResult = await db.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TblEmpDayOff')
      BEGIN
          CREATE TABLE dbo.TblEmpDayOff (
              ID INT IDENTITY(1,1) PRIMARY KEY,
              EmpID INT NOT NULL,
              OffDate DATE NOT NULL,
              OffType NVARCHAR(30) NOT NULL DEFAULT N'day_off',
              Reason NVARCHAR(200) NULL,
              IsPaid BIT NOT NULL DEFAULT 0,
              IsDeleted BIT NOT NULL DEFAULT 0,
              CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
              UpdatedAt DATETIME NULL,
              CONSTRAINT CK_TblEmpDayOff_OffType CHECK (OffType IN (N'day_off', N'sick', N'emergency', N'annual'))
          );
          
          ALTER TABLE dbo.TblEmpDayOff 
          ADD CONSTRAINT FK_TblEmpDayOff_TblEmp 
          FOREIGN KEY (EmpID) REFERENCES dbo.TblEmp(EmpID);
          
          CREATE UNIQUE INDEX UQ_TblEmpDayOff_Emp_Date 
          ON dbo.TblEmpDayOff (EmpID, OffDate) 
          WHERE IsDeleted = 0;
          
          CREATE INDEX IX_TblEmpDayOff_EmpID_OffDate 
          ON dbo.TblEmpDayOff (EmpID, OffDate);
          
          SELECT 1 as Success, 'TblEmpDayOff table created' as Message;
      END
      ELSE
      BEGIN
          SELECT 1 as Success, 'TblEmpDayOff table already exists' as Message;
      END
    `);
    migrationResults.push(dayOffResult.recordset[0]);

    return NextResponse.json({ 
      success: true, 
      message: "Migration completed successfully",
      results: migrationResults
    });

  } catch (error: any) {
    console.error('Migration error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}
