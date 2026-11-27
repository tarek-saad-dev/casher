-- Additive catalog; no historic participant/customer edits.
SET XACT_ABORT ON;
IF DB_NAME() NOT IN(N'last132_agent',N'last132') THROW 51420,'CUT_EDUCATION_UNEXPECTED_DB',1;
BEGIN TRANSACTION;
IF OBJECT_ID(N'dbo.CutEducationCatalog',N'U') IS NULL
CREATE TABLE dbo.CutEducationCatalog(
 TenantId UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Tenant(TenantId),
 EntryId UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
 EducationType VARCHAR(12) NOT NULL,
 Institution NVARCHAR(120) NOT NULL,
 FacultyOrSpecialization NVARCHAR(120) NOT NULL DEFAULT N'',
 IsActive BIT NOT NULL DEFAULT 1,
 CreatedBy INT NOT NULL,
 CreatedAtUtc DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
 CONSTRAINT PK_CutEducationCatalog PRIMARY KEY(TenantId,EntryId),
 CONSTRAINT UQ_CutEducationCatalog UNIQUE(TenantId,EducationType,Institution,FacultyOrSpecialization),
 CONSTRAINT CK_CutEducationCatalog_Type CHECK(EducationType IN('UNIVERSITY','SCHOOL','INSTITUTE')),
 CONSTRAINT CK_CutEducationCatalog_Names CHECK(LEN(Institution)>0 AND ((EducationType='SCHOOL' AND FacultyOrSpecialization=N'') OR (EducationType<>'SCHOOL' AND LEN(FacultyOrSpecialization)>0)))
);
COMMIT;
