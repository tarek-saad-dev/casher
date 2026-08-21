-- Booking V2 B4 — Effective Day availability projection (rebuildable cache).
-- NOT a source of truth. SoT = weekly baseline + date-specific layers.
-- Deploy-time only. Do NOT create from hot request paths.

IF OBJECT_ID(N'dbo.TblBookingEffectiveDayProjection', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblBookingEffectiveDayProjection (
    EmpID                INT NOT NULL,
    BranchID             INT NOT NULL,
    BusinessDate         DATE NOT NULL,
    SourceRevision       BIGINT NOT NULL,
    ProjectionRevision   BIGINT NOT NULL,
    ChangeMaskJson       NVARCHAR(MAX) NOT NULL,
    ReusedBaseline       BIT NOT NULL
      CONSTRAINT DF_EffDay_Reused DEFAULT (0),
    BitmapBase64         VARCHAR(256) NULL,
    FreeRangesJson       NVARCHAR(MAX) NOT NULL,
    IsWorking            BIT NOT NULL,
    SourceFingerprint    VARCHAR(64) NOT NULL,
    BaselineFingerprint  VARCHAR(64) NOT NULL,
    BuiltAtUtc           DATETIME2 NOT NULL
      CONSTRAINT DF_EffDay_BuiltAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_TblBookingEffectiveDayProjection
      PRIMARY KEY (EmpID, BranchID, BusinessDate)
  );

  CREATE NONCLUSTERED INDEX IX_EffDay_Branch_Date
    ON dbo.TblBookingEffectiveDayProjection (BranchID, BusinessDate)
    INCLUDE (EmpID, ProjectionRevision, SourceFingerprint);

  CREATE NONCLUSTERED INDEX IX_EffDay_Emp_Branch
    ON dbo.TblBookingEffectiveDayProjection (EmpID, BranchID)
    INCLUDE (BusinessDate, ProjectionRevision);
END
GO
