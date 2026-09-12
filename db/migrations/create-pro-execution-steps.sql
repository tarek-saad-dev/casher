-- ============================================================
-- Service execution steps (مراحل تنفيذ الخدمة)
-- Idempotent — safe to run multiple times
-- ============================================================

IF OBJECT_ID(N'dbo.TblProExecutionStep', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TblProExecutionStep (
        StepID             INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        ProID              INT NOT NULL,
        SortOrder          INT NOT NULL CONSTRAINT DF_TblProExecutionStep_SortOrder DEFAULT (0),
        TitleAr            NVARCHAR(200) NULL,
        TitleEn            NVARCHAR(200) NULL,
        DetailAr           NVARCHAR(1000) NULL,
        DetailEn           NVARCHAR(1000) NULL,
        DurationMinutes    INT NULL,
        CreatedAt          DATETIME2 NOT NULL CONSTRAINT DF_TblProExecutionStep_CreatedAt DEFAULT (SYSDATETIME()),
        UpdatedAt          DATETIME2 NULL,
        CONSTRAINT FK_TblProExecutionStep_Pro
            FOREIGN KEY (ProID) REFERENCES dbo.TblPro (ProID)
    );

    CREATE NONCLUSTERED INDEX IX_TblProExecutionStep_ProID_SortOrder
        ON dbo.TblProExecutionStep (ProID, SortOrder);

    PRINT 'Created: dbo.TblProExecutionStep';
END
ELSE
    PRINT 'Exists: dbo.TblProExecutionStep';
GO

PRINT '============================================================';
PRINT 'Pro execution steps migration complete';
PRINT '============================================================';
GO
