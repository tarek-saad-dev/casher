-- Additive nullable demographic fields. Legacy rows remain unchanged.
IF COL_LENGTH(N'dbo.TblClient', N'CustomerCategory') IS NULL
  ALTER TABLE dbo.TblClient ADD CustomerCategory NVARCHAR(16) NULL;
GO
IF COL_LENGTH(N'dbo.TblClient', N'EducationLevel') IS NULL
  ALTER TABLE dbo.TblClient ADD EducationLevel NVARCHAR(16) NULL;
GO
IF COL_LENGTH(N'dbo.TblClient', N'InstitutionName') IS NULL
  ALTER TABLE dbo.TblClient ADD InstitutionName NVARCHAR(150) NULL;
GO
IF COL_LENGTH(N'dbo.TblClient', N'Occupation') IS NULL
  ALTER TABLE dbo.TblClient ADD Occupation NVARCHAR(100) NULL;
GO
