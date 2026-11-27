-- Staging-only draft policy storage. Never execute on last132.
SET XACT_ABORT ON;
SET NOCOUNT ON;
IF DB_NAME()<>N'last132_agent' OR SUSER_SNAME()<>N'drvo_agent'
  THROW 52200,'CUT_CLUB_MEMBERSHIP_DRAFT_STAGE_ONLY',1;
IF OBJECT_ID(N'dbo.Tenant',N'U') IS NULL
  THROW 52201,'TENANT_REQUIRED',1;
BEGIN TRANSACTION;
IF OBJECT_ID(N'dbo.CutClubMembershipProgramDraft',N'U') IS NULL
BEGIN
 CREATE TABLE dbo.CutClubMembershipProgramDraft(
  TenantId UNIQUEIDENTIFIER NOT NULL,
  ProgramCode VARCHAR(40) COLLATE Latin1_General_100_BIN2 NOT NULL,
  Revision INT NOT NULL,
  Title NVARCHAR(100) NOT NULL,
  Kind VARCHAR(16) NOT NULL,
  MinimumVisits INT NOT NULL,
  Gleem BIT NOT NULL,
  CampShizar BIT NOT NULL,
  PartnerCode VARCHAR(40) COLLATE Latin1_General_100_BIN2 NULL,
  CreatedBy INT NOT NULL,
  Reason NVARCHAR(300) NOT NULL,
  CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_CutClubMembershipDraft_Created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_CutClubMembershipProgramDraft PRIMARY KEY(TenantId,ProgramCode,Revision),
  CONSTRAINT FK_CutClubMembershipDraft_Tenant FOREIGN KEY(TenantId) REFERENCES dbo.Tenant(TenantId),
  CONSTRAINT CK_CutClubMembershipDraft_Kind CHECK(Kind IN ('GENERAL','STUDENT','DOCTOR','COMPANY')),
  CONSTRAINT CK_CutClubMembershipDraft_Revision CHECK(Revision>0 AND CreatedBy>0 AND MinimumVisits BETWEEN 0 AND 100000),
  CONSTRAINT CK_CutClubMembershipDraft_Partner CHECK(Kind<>'GENERAL' OR PartnerCode IS NULL),
  CONSTRAINT CK_CutClubMembershipDraft_Scope CHECK(Gleem=1 OR CampShizar=1),
  CONSTRAINT CK_CutClubMembershipDraft_Reason CHECK(LEN(Reason) BETWEEN 5 AND 300 AND LEN(Title) BETWEEN 1 AND 100)
 );
END;
COMMIT TRANSACTION;
