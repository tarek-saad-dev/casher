/*
  DRVO public signup industry registry decoupling.

  Future industries are validated by the source-controlled Industry Pack registry.
  The database only enforces a safe non-empty industry code, so adding a pack does
  not require altering a CHECK constraint on every release.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF OBJECT_ID(N'dbo.PublicSignupRegistration', N'U') IS NOT NULL
  BEGIN
    IF EXISTS (
      SELECT 1
      FROM sys.check_constraints
      WHERE parent_object_id = OBJECT_ID(N'dbo.PublicSignupRegistration')
        AND name = N'CK_PublicSignupRegistration_Industry'
    )
      ALTER TABLE dbo.PublicSignupRegistration
        DROP CONSTRAINT CK_PublicSignupRegistration_Industry;

    IF NOT EXISTS (
      SELECT 1
      FROM sys.check_constraints
      WHERE parent_object_id = OBJECT_ID(N'dbo.PublicSignupRegistration')
        AND name = N'CK_PublicSignupRegistration_IndustryCode'
    )
      ALTER TABLE dbo.PublicSignupRegistration WITH CHECK
        ADD CONSTRAINT CK_PublicSignupRegistration_IndustryCode
        CHECK (
          LEN(LTRIM(RTRIM(IndustryCode))) BETWEEN 2 AND 64
          AND IndustryCode NOT LIKE N'%[^a-z0-9_-]%'
        );
  END;

  COMMIT TRAN;
  SELECT N'DRVO public signup industry registry decoupled' AS Result;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
