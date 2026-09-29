/*
  DRVO central migration registry — idempotent.
  Records applied schema/data migrations; never stores business data.
*/
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.DrvoSchemaMigration', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.DrvoSchemaMigration (
    MigrationId INT NOT NULL,
    MigrationKey NVARCHAR(64) NOT NULL,
    Name NVARCHAR(256) NOT NULL,
    Checksum NVARCHAR(64) NOT NULL,
    AppliedAtUtc DATETIME2 NOT NULL CONSTRAINT DF_DrvoSchemaMigration_AppliedAtUtc DEFAULT SYSUTCDATETIME(),
    AppCommitSha NVARCHAR(64) NULL,
    ExecutionMs INT NOT NULL CONSTRAINT DF_DrvoSchemaMigration_ExecutionMs DEFAULT 0,
    CONSTRAINT PK_DrvoSchemaMigration PRIMARY KEY (MigrationId),
    CONSTRAINT UQ_DrvoSchemaMigration_Key UNIQUE (MigrationKey)
  );

  CREATE INDEX IX_DrvoSchemaMigration_AppliedAtUtc
    ON dbo.DrvoSchemaMigration (AppliedAtUtc);
END;
