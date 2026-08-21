-- Booking V2 B9.5 — persistent public bootstrap snapshot (cross-instance).
-- Deploy-time only. Catalog SoT remains branch/emp/service tables.

IF OBJECT_ID(N'dbo.TblBookingBootstrapSnapshot', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblBookingBootstrapSnapshot (
    ScopeKey      NVARCHAR(80)  NOT NULL,
    Revision      NVARCHAR(40)  NOT NULL,
    PayloadJson   NVARCHAR(MAX) NOT NULL,
    BuiltAtUtc    DATETIME2(3)  NOT NULL
      CONSTRAINT DF_BootstrapSnap_Built DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_TblBookingBootstrapSnapshot PRIMARY KEY (ScopeKey)
  );
END
GO
