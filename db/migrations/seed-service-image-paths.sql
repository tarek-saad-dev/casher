-- ============================================================
-- Seed ImageUrl paths for barber services (idempotent)
-- Maps local images in public/services/ to TblPro rows by ProName
-- ============================================================

IF COL_LENGTH(N'dbo.TblPro', N'ImageUrl') IS NULL
BEGIN
    ALTER TABLE dbo.TblPro
    ADD ImageUrl NVARCHAR(1000) NULL;
    PRINT 'Added: TblPro.ImageUrl';
END
GO

UPDATE [dbo].[TblPro] SET ImageUrl = N'/services/haircut.jpg'   WHERE ProName = N'Hair Cut'              AND (ImageUrl IS NULL OR LTRIM(RTRIM(ImageUrl)) = N'');
UPDATE [dbo].[TblPro] SET ImageUrl = N'/services/hb.jpeg'       WHERE ProName = N'Haircut & Beard'       AND (ImageUrl IS NULL OR LTRIM(RTRIM(ImageUrl)) = N'');
UPDATE [dbo].[TblPro] SET ImageUrl = N'/services/beard.jpeg'     WHERE ProName = N'Beard Styling & Fade'  AND (ImageUrl IS NULL OR LTRIM(RTRIM(ImageUrl)) = N'');
UPDATE [dbo].[TblPro] SET ImageUrl = N'/services/fade.jpeg'      WHERE ProName = N'Fade Cut'              AND (ImageUrl IS NULL OR LTRIM(RTRIM(ImageUrl)) = N'');
UPDATE [dbo].[TblPro] SET ImageUrl = N'/services/advanced.jpeg'  WHERE ProName = N'Advanced Cut'          AND (ImageUrl IS NULL OR LTRIM(RTRIM(ImageUrl)) = N'');
UPDATE [dbo].[TblPro] SET ImageUrl = N'/services/thread.jpeg'    WHERE ProName = N'Face Threading'        AND (ImageUrl IS NULL OR LTRIM(RTRIM(ImageUrl)) = N'');
UPDATE [dbo].[TblPro] SET ImageUrl = N'/services/shaver.jpeg'    WHERE ProName = N'Zero Beard Shave'      AND (ImageUrl IS NULL OR LTRIM(RTRIM(ImageUrl)) = N'');
UPDATE [dbo].[TblPro] SET ImageUrl = N'/services/basic.jpeg'    WHERE ProName = N'Basic Skin Care'     AND (ImageUrl IS NULL OR LTRIM(RTRIM(ImageUrl)) = N'');
GO

PRINT '============================================================';
PRINT 'Service image paths seeded (only rows with empty ImageUrl).';
GO
