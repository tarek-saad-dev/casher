-- ============================================================
-- Phase 1E: Effective-dated branch partner shares
-- Idempotent. Does not change financial transaction tables.
-- ============================================================
SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.TblBranchPartnerShare', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TblBranchPartnerShare (
        BranchPartnerShareID BIGINT IDENTITY(1,1) NOT NULL,
        BranchID             INT NOT NULL,
        PartnerUserID        INT NULL,
        PartnerCode          NVARCHAR(50) NOT NULL,
        PartnerName          NVARCHAR(100) NOT NULL,
        SharePercent         DECIMAL(9,6) NOT NULL,
        EffectiveFrom        DATE NOT NULL,
        EffectiveTo          DATE NULL,
        IsActive             BIT NOT NULL CONSTRAINT DF_TblBranchPartnerShare_IsActive DEFAULT (1),
        CreatedAt            DATETIME2(0) NOT NULL CONSTRAINT DF_TblBranchPartnerShare_CreatedAt DEFAULT (SYSUTCDATETIME()),
        UpdatedAt            DATETIME2(0) NULL,
        CreatedByUserID      INT NULL,
        Notes                NVARCHAR(250) NULL,
        CONSTRAINT PK_TblBranchPartnerShare PRIMARY KEY CLUSTERED (BranchPartnerShareID),
        CONSTRAINT FK_TblBranchPartnerShare_Branch
            FOREIGN KEY (BranchID) REFERENCES dbo.TblBranch (BranchID),
        CONSTRAINT CK_TblBranchPartnerShare_Percent
            CHECK (SharePercent > 0 AND SharePercent <= 100),
        CONSTRAINT CK_TblBranchPartnerShare_Dates
            CHECK (EffectiveTo IS NULL OR EffectiveTo >= EffectiveFrom)
    );
    PRINT 'Created TblBranchPartnerShare';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UX_TblBranchPartnerShare_Branch_Partner_From'
      AND object_id = OBJECT_ID(N'dbo.TblBranchPartnerShare')
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UX_TblBranchPartnerShare_Branch_Partner_From
        ON dbo.TblBranchPartnerShare (BranchID, PartnerCode, EffectiveFrom);
    PRINT 'Created UX_TblBranchPartnerShare_Branch_Partner_From';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblBranchPartnerShare_Branch_Active_Dates'
      AND object_id = OBJECT_ID(N'dbo.TblBranchPartnerShare')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_TblBranchPartnerShare_Branch_Active_Dates
        ON dbo.TblBranchPartnerShare (BranchID, IsActive, EffectiveFrom, EffectiveTo)
        INCLUDE (PartnerCode, PartnerName, SharePercent);
    PRINT 'Created IX_TblBranchPartnerShare_Branch_Active_Dates';
END
GO

-- Optional FK to TblUser only when PartnerUserID is used (nullable; no FK forced —
-- partners are not always users). Left without FK to avoid false identity coupling.

------------------------------------------------------------
-- GLEEM seed: matches hardcoded PARTNERS as of Phase 1E
-- EffectiveFrom = 2026-06-01 (partners report minimum period)
------------------------------------------------------------
DECLARE @GleemBranchID INT =
    (SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM');

IF @GleemBranchID IS NULL
BEGIN
    RAISERROR(N'Phase 1E partner seed requires founding branch GLEEM', 16, 1);
END
ELSE IF NOT EXISTS (
    SELECT 1
    FROM dbo.TblBranchPartnerShare
    WHERE BranchID = @GleemBranchID
      AND EffectiveFrom = '2026-06-01'
      AND PartnerCode = N'ZIYAD'
)
BEGIN
    INSERT INTO dbo.TblBranchPartnerShare (
        BranchID, PartnerUserID, PartnerCode, PartnerName, SharePercent,
        EffectiveFrom, EffectiveTo, IsActive, Notes
    ) VALUES
    (@GleemBranchID, NULL, N'ZIYAD',       N'زياد',       CAST(36.666667 AS DECIMAL(9,6)), '2026-06-01', NULL, 1,
        N'Phase 1E seed from hardcoded PARTNERS'),
    (@GleemBranchID, NULL, N'MHAMDY',      N'محمد حمدي',  CAST(31.666667 AS DECIMAL(9,6)), '2026-06-01', NULL, 1,
        N'Phase 1E seed from hardcoded PARTNERS'),
    (@GleemBranchID, NULL, N'ALIZAINY',    N'علي الزيني', CAST(31.666666 AS DECIMAL(9,6)), '2026-06-01', NULL, 1,
        N'Phase 1E seed from hardcoded PARTNERS');

    PRINT 'Seeded GLEEM partner shares EffectiveFrom=2026-06-01';
END
ELSE
    PRINT 'GLEEM partner share seed already present';
GO

PRINT 'Phase 1E partner share migration complete';
GO
