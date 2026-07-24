/*
  Add display order for service categories (TblCat).
  Lower SortOrder = appears first in catalog / admin / public UIs.

  Safe to re-run.
*/

IF COL_LENGTH(N'dbo.TblCat', N'SortOrder') IS NULL
BEGIN
  ALTER TABLE dbo.TblCat
  ADD SortOrder INT NOT NULL
    CONSTRAINT DF_TblCat_SortOrder DEFAULT (0);
END;
GO

-- Preferred salon order (only when still default 0)
UPDATE dbo.TblCat SET SortOrder = 10 WHERE SortOrder = 0 AND CatName = N'حلاقة';
UPDATE dbo.TblCat SET SortOrder = 20 WHERE SortOrder = 0 AND LOWER(CatName) = N'skincare';
UPDATE dbo.TblCat SET SortOrder = 30 WHERE SortOrder = 0 AND CatName = N'خدمات اضافيه للشعر';
UPDATE dbo.TblCat SET SortOrder = 40 WHERE SortOrder = 0 AND CatName = N'معالجات شعر';
UPDATE dbo.TblCat SET SortOrder = 50 WHERE SortOrder = 0 AND CatName = N'كريم شعر';
GO

-- Remaining categories: after known ones, alphabetical
;WITH ranked AS (
  SELECT CatID,
    ROW_NUMBER() OVER (ORDER BY CatName) * 10 AS rn
  FROM dbo.TblCat
  WHERE SortOrder = 0
)
UPDATE c
SET SortOrder = ranked.rn + 1000
FROM dbo.TblCat c
INNER JOIN ranked ON ranked.CatID = c.CatID;
GO
