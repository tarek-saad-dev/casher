-- Web Push subscriptions for CUT STAFF employee portal notifications.
IF OBJECT_ID(N'dbo.TblEmployeePortalPushSubscription', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblEmployeePortalPushSubscription (
    ID int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    EmpID int NOT NULL,
    TenantId nvarchar(100) NOT NULL,
    Endpoint nvarchar(1000) NOT NULL,
    P256dh nvarchar(255) NOT NULL,
    Auth nvarchar(255) NOT NULL,
    UserAgent nvarchar(400) NULL,
    CreatedAt datetime2 NOT NULL CONSTRAINT DF_EmployeePortalPushCreated DEFAULT SYSUTCDATETIME(),
    UpdatedAt datetime2 NULL,
    CONSTRAINT FK_EmployeePortalPushEmp FOREIGN KEY (EmpID) REFERENCES dbo.TblEmp(EmpID),
    CONSTRAINT UQ_EmployeePortalPushEndpoint UNIQUE (Endpoint)
  );
  CREATE INDEX IX_EmployeePortalPush_EmpTenant
    ON dbo.TblEmployeePortalPushSubscription (EmpID, TenantId);
END;
