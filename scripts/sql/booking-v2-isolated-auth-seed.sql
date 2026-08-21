-- Isolated AUTH schema + localadmin seed for HawaiBookingV2Isolated ONLY.
-- Structure matches Azure last132 (READ-ONLY dump). No production passwords copied.
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET XACT_ABORT ON;

IF DB_NAME() = N'last132'
BEGIN
  RAISERROR(N'REFUSING: last132', 16, 1);
  RETURN;
END

------------------------------------------------------------
-- TblShift
------------------------------------------------------------
IF OBJECT_ID(N'dbo.TblShift', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblShift (
    ShiftID   INT IDENTITY(1,1) NOT NULL,
    ShiftName NVARCHAR(50) NULL,
    CONSTRAINT PK_TblShift PRIMARY KEY CLUSTERED (ShiftID)
  );
END

------------------------------------------------------------
-- TblUser (ShiftID NOT NULL + FK like last132)
------------------------------------------------------------
IF OBJECT_ID(N'dbo.TblUser', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblUser (
    UserID    INT IDENTITY(1,1) NOT NULL,
    UserName  NVARCHAR(50) NULL,
    UserLevel NVARCHAR(5) NULL,
    loginName NVARCHAR(50) NULL,
    Password  NVARCHAR(50) NULL,
    ShiftID   INT NOT NULL,
    CardNO    NVARCHAR(30) NULL,
    isDeleted BIT NULL,
    CONSTRAINT PK_TblUser PRIMARY KEY CLUSTERED (UserID),
    CONSTRAINT FK_TblUser_TblShift FOREIGN KEY (ShiftID) REFERENCES dbo.TblShift (ShiftID)
  );
END

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = N'IX_TblUser_loginName' AND object_id = OBJECT_ID(N'dbo.TblUser')
)
BEGIN
  CREATE NONCLUSTERED INDEX IX_TblUser_loginName ON dbo.TblUser (loginName);
END

------------------------------------------------------------
-- TblUserBranchAccess
------------------------------------------------------------
IF OBJECT_ID(N'dbo.TblUserBranchAccess', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblUserBranchAccess (
    ID              BIGINT IDENTITY(1,1) NOT NULL,
    UserID          INT NOT NULL,
    BranchID        INT NOT NULL,
    IsDefault       BIT NOT NULL CONSTRAINT DF_TblUserBranchAccess_IsDefault DEFAULT ((0)),
    CanOperate      BIT NOT NULL CONSTRAINT DF_TblUserBranchAccess_CanOperate DEFAULT ((1)),
    CanViewReports  BIT NOT NULL CONSTRAINT DF_TblUserBranchAccess_CanViewReports DEFAULT ((0)),
    CanSwitch       BIT NOT NULL CONSTRAINT DF_TblUserBranchAccess_CanSwitch DEFAULT ((0)),
    IsActive        BIT NOT NULL CONSTRAINT DF_TblUserBranchAccess_IsActive DEFAULT ((1)),
    ValidFrom       DATETIME2 NOT NULL,
    ValidTo         DATETIME2 NULL,
    GrantedByUserID INT NULL,
    GrantReason     NVARCHAR(250) NULL,
    CreatedAt       DATETIME2 NOT NULL CONSTRAINT DF_TblUserBranchAccess_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt       DATETIME2 NULL,
    CONSTRAINT PK_TblUserBranchAccess PRIMARY KEY CLUSTERED (ID),
    CONSTRAINT UQ_TblUserBranchAccess_User_Branch UNIQUE (UserID, BranchID),
    CONSTRAINT FK_TblUserBranchAccess_UserID FOREIGN KEY (UserID) REFERENCES dbo.TblUser (UserID),
    CONSTRAINT FK_TblUserBranchAccess_BranchID FOREIGN KEY (BranchID) REFERENCES dbo.TblBranch (BranchID),
    CONSTRAINT FK_TblUserBranchAccess_GrantedByUserID FOREIGN KEY (GrantedByUserID) REFERENCES dbo.TblUser (UserID),
    CONSTRAINT CK_TblUserBranchAccess_ValidRange CHECK ([ValidTo] IS NULL OR [ValidTo] > [ValidFrom])
  );
END

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'UX_TblUserBranchAccess_OneActiveDefault'
    AND object_id = OBJECT_ID(N'dbo.TblUserBranchAccess')
)
BEGIN
  CREATE UNIQUE NONCLUSTERED INDEX UX_TblUserBranchAccess_OneActiveDefault
    ON dbo.TblUserBranchAccess (UserID)
    WHERE [IsDefault] = 1 AND [IsActive] = 1;
END

------------------------------------------------------------
-- Roles / pages
------------------------------------------------------------
IF OBJECT_ID(N'dbo.TblRoles', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblRoles (
    RoleID      INT IDENTITY(1,1) NOT NULL,
    RoleKey     NVARCHAR(50) NOT NULL,
    RoleName    NVARCHAR(100) NOT NULL,
    Description NVARCHAR(255) NULL,
    IsActive    BIT NOT NULL CONSTRAINT DF_TblRoles_IsActive DEFAULT ((1)),
    CreatedAt   DATETIME2 NOT NULL CONSTRAINT DF_TblRoles_CreatedAt DEFAULT (GETDATE()),
    CONSTRAINT PK_TblRoles PRIMARY KEY CLUSTERED (RoleID),
    CONSTRAINT UQ_TblRoles_RoleKey UNIQUE (RoleKey)
  );
END

IF OBJECT_ID(N'dbo.TblUserRoles', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblUserRoles (
    ID         INT IDENTITY(1,1) NOT NULL,
    UserID     INT NOT NULL,
    RoleID     INT NOT NULL,
    AssignedAt DATETIME2 NOT NULL CONSTRAINT DF_TblUserRoles_AssignedAt DEFAULT (GETDATE()),
    CONSTRAINT PK_TblUserRoles PRIMARY KEY CLUSTERED (ID),
    CONSTRAINT UQ_UserRoles UNIQUE (UserID, RoleID),
    CONSTRAINT FK_TblUserRoles_UserID FOREIGN KEY (UserID) REFERENCES dbo.TblUser (UserID),
    CONSTRAINT FK_TblUserRoles_RoleID FOREIGN KEY (RoleID) REFERENCES dbo.TblRoles (RoleID)
  );
END

IF OBJECT_ID(N'dbo.TblSystemPages', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblSystemPages (
    PageID     INT IDENTITY(1,1) NOT NULL,
    PageKey    NVARCHAR(100) NOT NULL,
    PageName   NVARCHAR(150) NOT NULL,
    PagePath   NVARCHAR(255) NOT NULL,
    Section    NVARCHAR(100) NULL,
    AccessMode NVARCHAR(30) NOT NULL CONSTRAINT DF_TblSystemPages_AccessMode DEFAULT (N'roles'),
    SortOrder  INT NOT NULL CONSTRAINT DF_TblSystemPages_SortOrder DEFAULT ((0)),
    IsActive   BIT NOT NULL CONSTRAINT DF_TblSystemPages_IsActive DEFAULT ((1)),
    CreatedAt  DATETIME2 NOT NULL CONSTRAINT DF_TblSystemPages_CreatedAt DEFAULT (GETDATE()),
    CONSTRAINT PK_TblSystemPages PRIMARY KEY CLUSTERED (PageID),
    CONSTRAINT UQ_TblSystemPages_PageKey UNIQUE (PageKey)
  );
END

IF OBJECT_ID(N'dbo.TblNewDay', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblNewDay (
    ID INT IDENTITY(1,1) NOT NULL,
    NewDay DATE NOT NULL,
    Status BIT NULL,
    BranchID INT NOT NULL,
    CONSTRAINT PK_TblNewDay PRIMARY KEY CLUSTERED (ID),
    CONSTRAINT FK_TblNewDay_BranchID FOREIGN KEY (BranchID) REFERENCES dbo.TblBranch (BranchID)
  );
END

IF OBJECT_ID(N'dbo.TblShiftMove', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblShiftMove (
    ID INT IDENTITY(1,1) NOT NULL,
    NewDay DATE NOT NULL,
    UserID INT NULL,
    ShiftID INT NULL,
    StartDate DATE NULL,
    StartTime NCHAR(10) NULL,
    EndDate DATE NULL,
    EndTime NVARCHAR(50) NULL,
    Status BIT NULL,
    BranchID INT NOT NULL,
    BusinessDayID INT NOT NULL,
    CONSTRAINT PK_TblShiftMove PRIMARY KEY CLUSTERED (ID),
    CONSTRAINT FK_TblShiftMove_BusinessDayID FOREIGN KEY (BusinessDayID) REFERENCES dbo.TblNewDay (ID),
    CONSTRAINT FK_TblShiftMove_BranchID FOREIGN KEY (BranchID) REFERENCES dbo.TblBranch (BranchID),
    CONSTRAINT FK_TblShiftMove_TblShift FOREIGN KEY (ShiftID) REFERENCES dbo.TblShift (ShiftID),
    CONSTRAINT FK_TblShiftMove_TblUser FOREIGN KEY (UserID) REFERENCES dbo.TblUser (UserID)
  );
END

IF OBJECT_ID(N'dbo.TblPageRoleAccess', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblPageRoleAccess (
    ID        INT IDENTITY(1,1) NOT NULL,
    PageID    INT NOT NULL,
    RoleID    INT NOT NULL,
    CanView   BIT NOT NULL CONSTRAINT DF_TblPageRoleAccess_CanView DEFAULT ((1)),
    CanEdit   BIT NOT NULL CONSTRAINT DF_TblPageRoleAccess_CanEdit DEFAULT ((0)),
    CanDelete BIT NOT NULL CONSTRAINT DF_TblPageRoleAccess_CanDelete DEFAULT ((0)),
    CONSTRAINT PK_TblPageRoleAccess PRIMARY KEY CLUSTERED (ID),
    CONSTRAINT UQ_PageRoleAccess UNIQUE (PageID, RoleID),
    CONSTRAINT FK_TblPageRoleAccess_PageID FOREIGN KEY (PageID) REFERENCES dbo.TblSystemPages (PageID),
    CONSTRAINT FK_TblPageRoleAccess_RoleID FOREIGN KEY (RoleID) REFERENCES dbo.TblRoles (RoleID)
  );
END
GO

------------------------------------------------------------
-- Local seed only (plaintext password matches login SQL; no production secrets)
------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM dbo.TblShift WHERE ShiftName = N'Isolated')
  INSERT INTO dbo.TblShift (ShiftName) VALUES (N'Isolated');

DECLARE @shiftId INT = (SELECT TOP (1) ShiftID FROM dbo.TblShift ORDER BY ShiftID);

IF NOT EXISTS (SELECT 1 FROM dbo.TblUser WHERE loginName = N'localadmin')
BEGIN
  INSERT INTO dbo.TblUser (UserName, UserLevel, loginName, Password, ShiftID, CardNO, isDeleted)
  VALUES (N'Local Isolated Admin', N'admin', N'localadmin', N'LocalTest123', @shiftId, NULL, 0);
END
ELSE
BEGIN
  UPDATE dbo.TblUser
  SET Password = N'LocalTest123',
      UserLevel = N'admin',
      isDeleted = 0,
      ShiftID = ISNULL(ShiftID, @shiftId)
  WHERE loginName = N'localadmin';
END

DECLARE @uid INT = (SELECT UserID FROM dbo.TblUser WHERE loginName = N'localadmin');
DECLARE @gleem INT = (SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM');
DECLARE @camp INT = (SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'CAMP_CAESAR');

IF @uid IS NULL OR @gleem IS NULL
BEGIN
  RAISERROR(N'localadmin or GLEEM missing after seed', 16, 1);
  RETURN;
END

IF NOT EXISTS (SELECT 1 FROM dbo.TblUserBranchAccess WHERE UserID = @uid AND BranchID = @gleem)
  INSERT INTO dbo.TblUserBranchAccess
    (UserID, BranchID, IsDefault, CanOperate, CanViewReports, CanSwitch, IsActive, ValidFrom, GrantReason)
  VALUES (@uid, @gleem, 1, 1, 1, 1, 1, SYSUTCDATETIME(), N'isolated-local-auth');
ELSE
  UPDATE dbo.TblUserBranchAccess
  SET IsDefault = 1, CanOperate = 1, CanViewReports = 1, CanSwitch = 1, IsActive = 1, ValidTo = NULL
  WHERE UserID = @uid AND BranchID = @gleem;

IF @camp IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.TblUserBranchAccess WHERE UserID = @uid AND BranchID = @camp)
  INSERT INTO dbo.TblUserBranchAccess
    (UserID, BranchID, IsDefault, CanOperate, CanViewReports, CanSwitch, IsActive, ValidFrom, GrantReason)
  VALUES (@uid, @camp, 0, 1, 1, 1, 1, SYSUTCDATETIME(), N'isolated-local-auth');
ELSE IF @camp IS NOT NULL
  UPDATE dbo.TblUserBranchAccess
  SET IsDefault = 0, CanOperate = 1, CanViewReports = 1, CanSwitch = 1, IsActive = 1, ValidTo = NULL
  WHERE UserID = @uid AND BranchID = @camp;

IF NOT EXISTS (SELECT 1 FROM dbo.TblRoles WHERE RoleKey = N'super_admin')
  INSERT INTO dbo.TblRoles (RoleKey, RoleName, Description, IsActive)
  VALUES (N'super_admin', N'مدير النظام الكامل', N'isolated local', 1);
IF NOT EXISTS (SELECT 1 FROM dbo.TblRoles WHERE RoleKey = N'admin')
  INSERT INTO dbo.TblRoles (RoleKey, RoleName, Description, IsActive)
  VALUES (N'admin', N'مدير عام', N'isolated local', 1);

DECLARE @ridSuper INT = (SELECT RoleID FROM dbo.TblRoles WHERE RoleKey = N'super_admin');
DECLARE @ridAdmin INT = (SELECT RoleID FROM dbo.TblRoles WHERE RoleKey = N'admin');

IF @ridSuper IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.TblUserRoles WHERE UserID = @uid AND RoleID = @ridSuper)
  INSERT INTO dbo.TblUserRoles (UserID, RoleID) VALUES (@uid, @ridSuper);
IF @ridAdmin IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.TblUserRoles WHERE UserID = @uid AND RoleID = @ridAdmin)
  INSERT INTO dbo.TblUserRoles (UserID, RoleID) VALUES (@uid, @ridAdmin);

;WITH Pages(PageKey, PageName, PagePath, Section, AccessMode, SortOrder) AS (
  SELECT * FROM (VALUES
    (N'operations.main', N'لوحة التشغيل', N'/operations', N'لوحة التشغيل', N'all', 5),
    (N'income.pos', N'نقطة البيع', N'/income/pos', N'المدخلات', N'roles', 10),
    (N'queue.live', N'لوحة الانتظار', N'/queue/live', N'الطابور', N'roles', 70),
    (N'queue.new', N'تذكرة جديدة', N'/queue/new', N'الطابور', N'roles', 71),
    (N'bookings.list', N'قائمة الحجوزات', N'/bookings', N'الحجوزات', N'roles', 80),
    (N'bookings.new', N'حجز جديد', N'/bookings/new', N'الحجوزات', N'roles', 81),
    (N'hr.workforce_availability', N'توافر الموظفين', N'/admin/workforce/availability', N'الموارد البشرية', N'all', 93),
    (N'admin.operations', N'مركز التشغيل', N'/admin/operations', N'الإدارة', N'roles', 100),
    (N'admin.booking_operations', N'تشغيل الحجز العام', N'/admin/booking/operations', N'الإدارة', N'roles', 100)
  ) v(PageKey, PageName, PagePath, Section, AccessMode, SortOrder)
)
MERGE dbo.TblSystemPages AS t
USING Pages AS s ON t.PageKey = s.PageKey
WHEN MATCHED THEN
  UPDATE SET PageName = s.PageName, PagePath = s.PagePath, Section = s.Section, AccessMode = s.AccessMode, SortOrder = s.SortOrder, IsActive = 1
WHEN NOT MATCHED THEN
  INSERT (PageKey, PageName, PagePath, Section, AccessMode, SortOrder, IsActive)
  VALUES (s.PageKey, s.PageName, s.PagePath, s.Section, s.AccessMode, s.SortOrder, 1);

INSERT INTO dbo.TblPageRoleAccess (PageID, RoleID, CanView, CanEdit, CanDelete)
SELECT p.PageID, r.RoleID, 1, 1, 1
FROM dbo.TblSystemPages p
CROSS JOIN dbo.TblRoles r
WHERE r.RoleKey IN (N'super_admin', N'admin')
  AND NOT EXISTS (
    SELECT 1 FROM dbo.TblPageRoleAccess x WHERE x.PageID = p.PageID AND x.RoleID = r.RoleID
  );

DECLARE @today DATE = CAST(SWITCHOFFSET(SYSUTCDATETIME(), '+03:00') AS DATE);
DECLARE @dayGleem INT;
IF NOT EXISTS (SELECT 1 FROM dbo.TblNewDay WHERE BranchID = @gleem AND Status = 1)
  INSERT INTO dbo.TblNewDay (BranchID, NewDay, Status) VALUES (@gleem, @today, 1);
IF @camp IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.TblNewDay WHERE BranchID = @camp AND Status = 1)
  INSERT INTO dbo.TblNewDay (BranchID, NewDay, Status) VALUES (@camp, @today, 1);
SET @dayGleem = (SELECT TOP 1 ID FROM dbo.TblNewDay WHERE BranchID = @gleem AND Status = 1 ORDER BY ID DESC);
IF @dayGleem IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.TblShiftMove WHERE UserID = @uid AND BranchID = @gleem AND Status = 1)
  INSERT INTO dbo.TblShiftMove (BranchID, BusinessDayID, NewDay, UserID, ShiftID, StartDate, StartTime, Status)
  VALUES (@gleem, @dayGleem, @today, @uid, @shiftId, @today, N'09:00:00 ', 1);

PRINT 'isolated-auth-seed complete';
SELECT DB_NAME() AS DbName;
SELECT UserID, loginName, UserLevel, ShiftID, isDeleted FROM dbo.TblUser WHERE loginName = N'localadmin';
SELECT b.BranchCode, uba.IsDefault, uba.CanOperate, uba.IsActive
FROM dbo.TblUserBranchAccess uba
JOIN dbo.TblBranch b ON b.BranchID = uba.BranchID
WHERE uba.UserID = (SELECT UserID FROM dbo.TblUser WHERE loginName = N'localadmin');
SELECT r.RoleKey
FROM dbo.TblUserRoles ur
JOIN dbo.TblRoles r ON r.RoleID = ur.RoleID
WHERE ur.UserID = (SELECT UserID FROM dbo.TblUser WHERE loginName = N'localadmin');
GO
