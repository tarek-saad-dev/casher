/*
  CUT CLUB 2.0 — DRAFT staging-only SQL Server authentication schema (#295).

  NOT part of automatic migration manifests. DO NOT apply from CI or production.
  Intended exclusively for a separately authorized operator on
  database last132_agent and SQL login drvo_agent, AFTER staging metadata review.
  Rollback MUST be explicitly planned, with synthetic-only data and a restore point.

  Values stored are HMAC-derived phone/OTP/IP digests or SHA-256 opaque token
  digests, never raw phone numbers, OTP codes, browser cookies or PII.
  Tenant rows and tenant->legacy customer bindings must already be verified.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF DB_NAME() <> N'last132_agent' OR SUSER_SNAME() <> N'drvo_agent'
  THROW 51950, 'CUT CLUB auth schema is explicitly staging-only', 1;

IF OBJECT_ID(N'dbo.Tenant', N'U') IS NULL
  THROW 51951, 'Tenant foundation missing; do not create auth tables', 1;

BEGIN TRY
  BEGIN TRAN;

  IF OBJECT_ID(N'dbo.CustomerOtpChallenge', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.CustomerOtpChallenge (
      ChallengeId VARCHAR(32) COLLATE Latin1_General_100_BIN2 NOT NULL,
      TenantId UNIQUEIDENTIFIER NOT NULL,
      PhoneDigest BINARY(32) NOT NULL,
      IpDigest BINARY(32) NOT NULL,
      CodeDigest BINARY(32) NOT NULL,
      SecretVersion SMALLINT NOT NULL CONSTRAINT DF_CutOtp_SecretVersion DEFAULT 1,
      Attempts TINYINT NOT NULL CONSTRAINT DF_CutOtp_Attempts DEFAULT 0,
      Status NVARCHAR(20) NOT NULL,
      Revision INT NOT NULL CONSTRAINT DF_CutOtp_Revision DEFAULT 0,
      CreatedAtSeconds BIGINT NOT NULL,
      ExpiresAtSeconds BIGINT NOT NULL,
      SentAtSeconds BIGINT NULL,
      CONSTRAINT PK_CustomerOtpChallenge PRIMARY KEY (TenantId, ChallengeId),
      CONSTRAINT FK_CustomerOtpChallenge_Tenant FOREIGN KEY (TenantId)
        REFERENCES dbo.Tenant(TenantId),
      CONSTRAINT CK_CustomerOtpChallenge_Attempts CHECK (Attempts BETWEEN 0 AND 5),
      CONSTRAINT CK_CustomerOtpChallenge_Revision CHECK (Revision >= 0),
      CONSTRAINT CK_CustomerOtpChallenge_SecretVersion CHECK (SecretVersion >= 1),
      CONSTRAINT CK_CustomerOtpChallenge_Status CHECK (Status IN
        (N'pending', N'consumed', N'locked', N'expired', N'replaced', N'delivery_failed')),
      CONSTRAINT CK_CustomerOtpChallenge_TTL CHECK
        (ExpiresAtSeconds > CreatedAtSeconds AND ExpiresAtSeconds - CreatedAtSeconds <= 300),
      CONSTRAINT CK_CustomerOtpChallenge_SentAt CHECK
        (SentAtSeconds IS NULL OR SentAtSeconds >= CreatedAtSeconds)
    );
  END;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.CustomerOtpChallenge')
      AND name = N'UX_CutOtp_Tenant_PendingPhone'
  )
  BEGIN
    -- At most one pending challenge per verified tenant/phone digest.
    CREATE UNIQUE INDEX UX_CutOtp_Tenant_PendingPhone
      ON dbo.CustomerOtpChallenge(TenantId, PhoneDigest)
      WHERE Status = N'pending';
  END;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.CustomerOtpChallenge')
      AND name = N'IX_CutOtp_Tenant_Expiry'
  )
    CREATE INDEX IX_CutOtp_Tenant_Expiry
      ON dbo.CustomerOtpChallenge(TenantId, ExpiresAtSeconds)
      INCLUDE (Status);

  IF OBJECT_ID(N'dbo.CustomerOtpRateLimit', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.CustomerOtpRateLimit (
      TenantId UNIQUEIDENTIFIER NOT NULL,
      Scope NVARCHAR(8) NOT NULL,
      SubjectDigest BINARY(32) NOT NULL,
      BucketStartSeconds BIGINT NOT NULL,
      Attempts INT NOT NULL,
      UpdatedAtSeconds BIGINT NOT NULL,
      CONSTRAINT PK_CustomerOtpRateLimit PRIMARY KEY
        (TenantId, Scope, SubjectDigest, BucketStartSeconds),
      CONSTRAINT FK_CustomerOtpRateLimit_Tenant FOREIGN KEY (TenantId)
        REFERENCES dbo.Tenant(TenantId),
      CONSTRAINT CK_CustomerOtpRateLimit_Scope CHECK (Scope IN (N'tenant', N'ip', N'phone')),
      CONSTRAINT CK_CustomerOtpRateLimit_Attempts CHECK (Attempts > 0 AND Attempts <= 100),
      CONSTRAINT CK_CustomerOtpRateLimit_Time CHECK
        (BucketStartSeconds >= 0 AND UpdatedAtSeconds >= BucketStartSeconds)
    );
  END;

  IF OBJECT_ID(N'dbo.CustomerSession', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.CustomerSession (
      TokenDigest BINARY(32) NOT NULL,
      TenantId UNIQUEIDENTIFIER NOT NULL,
      CustomerId INT NOT NULL,
      VerifiedAtSeconds BIGINT NOT NULL,
      CreatedAtSeconds BIGINT NOT NULL,
      ExpiresAtSeconds BIGINT NOT NULL,
      RevokedAtSeconds BIGINT NULL,
      CONSTRAINT PK_CustomerSession PRIMARY KEY (TenantId, TokenDigest),
      CONSTRAINT FK_CustomerSession_Tenant FOREIGN KEY (TenantId)
        REFERENCES dbo.Tenant(TenantId),
      CONSTRAINT CK_CustomerSession_Customer CHECK (CustomerId > 0),
      CONSTRAINT CK_CustomerSession_TTL CHECK
        (ExpiresAtSeconds > CreatedAtSeconds AND ExpiresAtSeconds - CreatedAtSeconds <= 7200),
      CONSTRAINT CK_CustomerSession_Verification CHECK
        (VerifiedAtSeconds > 0 AND CreatedAtSeconds >= VerifiedAtSeconds
          AND CreatedAtSeconds - VerifiedAtSeconds <= 300),
      CONSTRAINT CK_CustomerSession_Revoked CHECK
        (RevokedAtSeconds IS NULL OR RevokedAtSeconds >= CreatedAtSeconds)
    );
  END;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.CustomerSession')
      AND name = N'IX_CustomerSession_Tenant_Customer_Expiry'
  )
    CREATE INDEX IX_CustomerSession_Tenant_Customer_Expiry
      ON dbo.CustomerSession(TenantId, CustomerId, ExpiresAtSeconds)
      INCLUDE (RevokedAtSeconds);

  IF OBJECT_ID(N'dbo.CustomerAuthAudit', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.CustomerAuthAudit (
      AuditId BIGINT IDENTITY(1,1) NOT NULL,
      TenantId UNIQUEIDENTIFIER NOT NULL,
      EventName NVARCHAR(40) NOT NULL,
      ResultCode NVARCHAR(24) NOT NULL,
      OccurredAtSeconds BIGINT NOT NULL,
      CONSTRAINT PK_CustomerAuthAudit PRIMARY KEY (AuditId),
      CONSTRAINT FK_CustomerAuthAudit_Tenant FOREIGN KEY (TenantId)
        REFERENCES dbo.Tenant(TenantId),
      CONSTRAINT CK_CustomerAuthAudit_Event CHECK (EventName IN
        (N'challenge_reserved', N'challenge_rejected', N'challenge_consumed',
         N'delivery_failed', N'session_created', N'session_revoked')),
      CONSTRAINT CK_CustomerAuthAudit_Result CHECK
        (ResultCode IN (N'ok', N'rate_limited', N'invalid', N'unavailable'))
    );
  END;

  COMMIT TRAN;
  SELECT N'CUT CLUB staging auth schema staged successfully' AS SchemaStatus;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
