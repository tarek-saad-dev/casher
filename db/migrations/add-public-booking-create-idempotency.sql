-- Booking Phase 6 — durable public create idempotency
SET NOCOUNT ON;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = N'TblPublicBookingCreateRequest'
)
BEGIN
  CREATE TABLE dbo.TblPublicBookingCreateRequest (
    RequestID           BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_TblPublicBookingCreateRequest PRIMARY KEY,
    IdempotencyKey      NVARCHAR(128) NOT NULL,
    RequestFingerprint  CHAR(64) NOT NULL,
    Status              NVARCHAR(24) NOT NULL, -- PENDING | COMPLETED | FAILED
    BookingID           INT NULL,
    BookingCode         NVARCHAR(32) NULL,
    ResponseJson        NVARCHAR(MAX) NULL,
    LastErrorCode       NVARCHAR(64) NULL,
    NotificationSent    BIT NOT NULL CONSTRAINT DF_PBCReq_NotificationSent DEFAULT (0),
    CreatedAt           DATETIME2(0) NOT NULL CONSTRAINT DF_PBCReq_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CompletedAt         DATETIME2(0) NULL,
    CONSTRAINT UQ_TblPublicBookingCreateRequest_Key UNIQUE (IdempotencyKey)
  );
  PRINT 'Created TblPublicBookingCreateRequest';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_TblPublicBookingCreateRequest_BookingID'
    AND object_id = OBJECT_ID(N'dbo.TblPublicBookingCreateRequest')
)
BEGIN
  CREATE NONCLUSTERED INDEX IX_TblPublicBookingCreateRequest_BookingID
    ON dbo.TblPublicBookingCreateRequest (BookingID)
    WHERE BookingID IS NOT NULL;
END
GO
