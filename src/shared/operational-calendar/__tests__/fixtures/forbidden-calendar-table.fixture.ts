/** Test fixture — must not ship in production tree scans except boundary tests. */
export const FORBIDDEN = 'INSERT INTO dbo.TblNewDay SELECT * FROM dbo.TblShiftMove';
