import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

async function main() {
  const { getPool, closePool } = await import('../src/lib/db');
  const db = await getPool();
  console.log('db connected');

  const users = await db.request().query(`
    SELECT TOP 15 UserID, loginName, UserName, UserLevel
    FROM dbo.TblUser
    WHERE ISNULL(isDeleted, 0) = 0
    ORDER BY UserID
  `);
  console.log('users', JSON.stringify(users.recordset, null, 2));

  const branches = await db.request().query(`
    SELECT BranchID, BranchCode, BranchName, IsActive FROM dbo.TblBranch
  `);
  console.log('branches', JSON.stringify(branches.recordset, null, 2));

  const access = await db.request().query(`
    SELECT uba.UserID, u.loginName, uba.BranchID, b.BranchCode,
           uba.IsDefault, uba.IsActive, uba.ValidFrom, uba.ValidTo,
           uba.CanOperate, b.IsActive AS BranchIsActive
    FROM dbo.TblUserBranchAccess uba
    INNER JOIN dbo.TblUser u ON u.UserID = uba.UserID
    INNER JOIN dbo.TblBranch b ON b.BranchID = uba.BranchID
    ORDER BY uba.UserID
  `);
  console.log('access rows', access.recordset.length);
  console.log(JSON.stringify(access.recordset, null, 2));

  const defaults = await db.request().query(`
    SELECT u.UserID, u.loginName, u.UserName,
      (SELECT COUNT(*) FROM dbo.TblUserBranchAccess uba
        WHERE uba.UserID = u.UserID AND uba.IsDefault = 1 AND uba.IsActive = 1) AS DefaultCount,
      (SELECT COUNT(*) FROM dbo.TblUserBranchAccess uba
        WHERE uba.UserID = u.UserID) AS AccessCount
    FROM dbo.TblUser u
    WHERE ISNULL(u.isDeleted, 0) = 0
    ORDER BY u.UserID
  `);
  const missing = (
    defaults.recordset as Array<{
      loginName: string;
      UserName: string;
      DefaultCount: number;
      AccessCount: number;
    }>
  ).filter((r) => Number(r.DefaultCount) !== 1);
  console.log('users without exactly one active default', missing.length);
  console.log(JSON.stringify(missing, null, 2));

  await closePool();
}

main().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
