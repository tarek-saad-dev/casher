-- Employee self-service credentials are independent of POS operator accounts.
-- Intentionally does not auto-create passwords or enable accounts.
IF OBJECT_ID(N'dbo.TblEmployeePortalAccount', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblEmployeePortalAccount (
    ID int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    EmpID int NOT NULL,
    TenantId nvarchar(100) NOT NULL,
    LoginName nvarchar(100) NOT NULL,
    PasswordHash nvarchar(255) NOT NULL,
    IsEnabled bit NOT NULL CONSTRAINT DF_EmployeePortalEnabled DEFAULT (1),
    MustChangePassword bit NOT NULL CONSTRAINT DF_EmployeePortalMustChange DEFAULT (1),
    FailedAttempts int NOT NULL CONSTRAINT DF_EmployeePortalFailedAttempts DEFAULT (0),
    LockedUntil datetime2 NULL,
    CreatedAt datetime2 NOT NULL CONSTRAINT DF_EmployeePortalCreated DEFAULT SYSUTCDATETIME(),
    UpdatedAt datetime2 NULL,
    CONSTRAINT FK_EmployeePortalEmp FOREIGN KEY (EmpID) REFERENCES dbo.TblEmp(EmpID),
    CONSTRAINT UQ_EmployeePortalEmp UNIQUE (EmpID),
    CONSTRAINT UQ_EmployeePortalLogin UNIQUE (LoginName)
  );
END;
