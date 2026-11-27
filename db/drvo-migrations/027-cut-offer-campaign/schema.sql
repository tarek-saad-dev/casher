-- Draft additive schema. Do not execute manually on production.
SET XACT_ABORT ON;
SET NOCOUNT ON;
IF OBJECT_ID(N'dbo.Tenant',N'U') IS NULL OR COL_LENGTH(N'dbo.TblClient',N'TenantId') IS NULL
  THROW 51300,'DECEMBER_TENANT_PREREQUISITES_MISSING',1;
BEGIN TRANSACTION;
IF COL_LENGTH(N'dbo.TblClient',N'FacultyName') IS NULL
  ALTER TABLE dbo.TblClient ADD FacultyName NVARCHAR(120) NULL;
IF OBJECT_ID(N'dbo.CutOfferCampaign',N'U') IS NULL
CREATE TABLE dbo.CutOfferCampaign(
  TenantId UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Tenant(TenantId),
  CampaignId UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
  Code VARCHAR(48) NOT NULL,
  Status VARCHAR(12) NOT NULL DEFAULT 'DRAFT',
  StartsAtUtc DATETIME2(3) NOT NULL,
  EndsAtUtc DATETIME2(3) NOT NULL,
  FirstVisitPct TINYINT NOT NULL, StudentPct TINYINT NOT NULL, ClubPct TINYINT NOT NULL,
  MultiServicePct TINYINT NOT NULL, Friend1Pct TINYINT NOT NULL, Friend2Pct TINYINT NOT NULL, Friend3Pct TINYINT NOT NULL,
  CONSTRAINT PK_CutOfferCampaign PRIMARY KEY(TenantId,CampaignId),
  CONSTRAINT UQ_CutOfferCampaign_Code UNIQUE(TenantId,Code),
  CONSTRAINT CK_CutOfferCampaign_Status CHECK(Status IN ('DRAFT','ACTIVE','PAUSED','ENDED')),
  CONSTRAINT CK_CutOfferCampaign_Dates CHECK(StartsAtUtc<EndsAtUtc),
  CONSTRAINT CK_CutOfferCampaign_Rates CHECK(FirstVisitPct<=100 AND StudentPct<=100 AND ClubPct<=100
    AND MultiServicePct<=100 AND Friend1Pct<=Friend2Pct AND Friend2Pct<=Friend3Pct AND Friend3Pct<=100)
);
IF OBJECT_ID(N'dbo.CutOfferParticipant',N'U') IS NULL
CREATE TABLE dbo.CutOfferParticipant(
  TenantId UNIQUEIDENTIFIER NOT NULL, CampaignId UNIQUEIDENTIFIER NOT NULL,
  ParticipantId UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
  ClientId INT NULL, PhoneNormalized VARCHAR(16) NOT NULL, DisplayName NVARCHAR(100) NOT NULL,
  IsStudent BIT NOT NULL, EducationType VARCHAR(12) NULL, Institution NVARCHAR(120) NULL,
  FacultyOrSpecialization NVARCHAR(120) NULL, AcademicYear NVARCHAR(60) NULL,
  MarketingConsentRequested BIT NOT NULL DEFAULT 0,
  ReferralCode VARCHAR(32) NOT NULL, SessionDigest CHAR(64) NOT NULL,
  IdentityVerifiedAtUtc DATETIME2(3) NULL, IdentityVerifiedBy INT NULL,
  StudentVerifiedAtUtc DATETIME2(3) NULL, StudentVerifiedBy INT NULL,
  CreatedAtUtc DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_CutOfferParticipant PRIMARY KEY(TenantId,CampaignId,ParticipantId),
  CONSTRAINT FK_CutOfferParticipant_Campaign FOREIGN KEY(TenantId,CampaignId) REFERENCES dbo.CutOfferCampaign(TenantId,CampaignId),
  CONSTRAINT UQ_CutOfferParticipant_Phone UNIQUE(TenantId,CampaignId,PhoneNormalized),
  CONSTRAINT UQ_CutOfferParticipant_Code UNIQUE(TenantId,CampaignId,ReferralCode),
  CONSTRAINT UQ_CutOfferParticipant_Session UNIQUE(TenantId,CampaignId,SessionDigest),
  CONSTRAINT CK_CutOfferParticipant_Phone CHECK(LEN(PhoneNormalized)=13 AND PhoneNormalized LIKE '+201[0125]%' AND SUBSTRING(PhoneNormalized,2,12) NOT LIKE '%[^0-9]%'),
  CONSTRAINT CK_CutOfferParticipant_Education CHECK(
    (IsStudent=0 AND EducationType IS NULL AND Institution IS NULL AND FacultyOrSpecialization IS NULL)
    OR (IsStudent=1 AND EducationType IS NOT NULL AND Institution IS NOT NULL AND
      ((EducationType='SCHOOL' AND FacultyOrSpecialization IS NULL)
       OR (EducationType IN ('UNIVERSITY','INSTITUTE') AND FacultyOrSpecialization IS NOT NULL)))),
  CONSTRAINT CK_CutOfferParticipant_Identity CHECK(
    (ClientId IS NULL AND IdentityVerifiedAtUtc IS NULL AND IdentityVerifiedBy IS NULL)
    OR (ClientId IS NOT NULL AND IdentityVerifiedAtUtc IS NOT NULL AND IdentityVerifiedBy IS NOT NULL)),
  CONSTRAINT CK_CutOfferParticipant_Student CHECK(
    (StudentVerifiedAtUtc IS NULL AND StudentVerifiedBy IS NULL)
    OR (IsStudent=1 AND IdentityVerifiedAtUtc IS NOT NULL AND StudentVerifiedAtUtc IS NOT NULL AND StudentVerifiedBy IS NOT NULL))
);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.CutOfferParticipant') AND name=N'UX_CutOfferParticipant_Client')
CREATE UNIQUE INDEX UX_CutOfferParticipant_Client ON dbo.CutOfferParticipant(TenantId,CampaignId,ClientId) WHERE ClientId IS NOT NULL;
IF OBJECT_ID(N'dbo.CutOfferReferral',N'U') IS NULL
CREATE TABLE dbo.CutOfferReferral(
  TenantId UNIQUEIDENTIFIER NOT NULL, CampaignId UNIQUEIDENTIFIER NOT NULL,
  InviteeId UNIQUEIDENTIFIER NOT NULL, InviterId UNIQUEIDENTIFIER NOT NULL,
  Status VARCHAR(12) NOT NULL DEFAULT 'PENDING', InvoiceId INT NULL,
  CreatedAtUtc DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  ConfirmedAtUtc DATETIME2(3) NULL,
  CONSTRAINT PK_CutOfferReferral PRIMARY KEY(TenantId,CampaignId,InviteeId),
  CONSTRAINT FK_CutOfferReferral_Invitee FOREIGN KEY(TenantId,CampaignId,InviteeId) REFERENCES dbo.CutOfferParticipant(TenantId,CampaignId,ParticipantId),
  CONSTRAINT FK_CutOfferReferral_Inviter FOREIGN KEY(TenantId,CampaignId,InviterId) REFERENCES dbo.CutOfferParticipant(TenantId,CampaignId,ParticipantId),
  CONSTRAINT CK_CutOfferReferral_Self CHECK(InviteeId<>InviterId),
  CONSTRAINT CK_CutOfferReferral_Status CHECK(Status IN ('PENDING','CONFIRMED','REJECTED','VOIDED')),
  CONSTRAINT CK_CutOfferReferral_Confirmation CHECK(Status<>'CONFIRMED' OR (InvoiceId IS NOT NULL AND ConfirmedAtUtc IS NOT NULL))
);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.CutOfferReferral') AND name=N'IX_CutOfferReferral_Inviter')
CREATE INDEX IX_CutOfferReferral_Inviter ON dbo.CutOfferReferral(TenantId,CampaignId,InviterId,Status);
IF OBJECT_ID(N'dbo.CutOfferRedemption',N'U') IS NULL
CREATE TABLE dbo.CutOfferRedemption(
  TenantId UNIQUEIDENTIFIER NOT NULL, CampaignId UNIQUEIDENTIFIER NOT NULL,
  ClientId INT NOT NULL, ParticipantId UNIQUEIDENTIFIER NOT NULL, InvoiceId INT NOT NULL,
  PercentApplied TINYINT NOT NULL, EligibleSubtotalMinor BIGINT NOT NULL, DiscountMinor BIGINT NOT NULL,
  RedeemedAtUtc DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_CutOfferRedemption PRIMARY KEY(TenantId,CampaignId,ClientId),
  CONSTRAINT UQ_CutOfferRedemption_Invoice UNIQUE(TenantId,CampaignId,InvoiceId),
  CONSTRAINT FK_CutOfferRedemption_Participant FOREIGN KEY(TenantId,CampaignId,ParticipantId) REFERENCES dbo.CutOfferParticipant(TenantId,CampaignId,ParticipantId),
  CONSTRAINT CK_CutOfferRedemption_Amount CHECK(PercentApplied<=100 AND EligibleSubtotalMinor>=0 AND DiscountMinor>=0 AND DiscountMinor<=EligibleSubtotalMinor)
);
COMMIT;
