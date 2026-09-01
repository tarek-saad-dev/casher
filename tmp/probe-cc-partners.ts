import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const orig = m._load;
m._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

async function main() {
  const { getPool } = await import('@/lib/db');
  const db = await getPool();

  const partners = await db.request().query(`
    SELECT s.*, b.BranchCode
    FROM dbo.TblBranchPartnerShare s
    JOIN dbo.TblBranch b ON b.BranchID = s.BranchID
    WHERE b.BranchCode = N'CAMP_CAESAR'
    ORDER BY s.EffectiveFrom, s.PartnerCode
  `);
  console.log('=== CURRENT CC PARTNERS ===');
  console.table(partners.recordset);

  const users = await db.request().query(`
    SELECT UserID, UserName, UserLevel
    FROM dbo.TblUser
    WHERE ISNULL(isDeleted, 0) = 0
      AND (
        UserName LIKE N'%tarek%' OR UserName LIKE N'%طارق%'
        OR UserName LIKE N'%ziad%' OR UserName LIKE N'%ذياد%' OR UserName LIKE N'%زياد%'
        OR UserName LIKE N'%saad%' OR UserName LIKE N'%سعد%'
        OR UserName LIKE N'%omar%' OR UserName LIKE N'%عمر%'
      )
    ORDER BY UserID
  `);
  console.log('=== USERS ===');
  console.table(users.recordset);

  const roles = await db.request().query(`
    SELECT u.UserID, u.UserName, r.RoleKey
    FROM dbo.TblUser u
    JOIN dbo.TblUserRoles ur ON ur.UserID = u.UserID
    JOIN dbo.TblRoles r ON r.RoleID = ur.RoleID
    WHERE ISNULL(u.isDeleted, 0) = 0
    ORDER BY u.UserID
  `);
  console.log('=== USER ROLES ===');
  console.table(roles.recordset);

  const access = await db.request().query(`
    SELECT uba.UserID, u.UserName, b.BranchCode, uba.CanViewReports, uba.IsDefault
    FROM dbo.TblUserBranchAccess uba
    JOIN dbo.TblUser u ON u.UserID = uba.UserID
    JOIN dbo.TblBranch b ON b.BranchID = uba.BranchID
    WHERE b.BranchCode = N'CAMP_CAESAR' AND uba.IsActive = 1
  `);
  console.log('=== CC ACCESS ===');
  console.table(access.recordset);

  const allUsers = await db.request().query(`
    SELECT UserID, UserName, UserLevel
    FROM dbo.TblUser WHERE ISNULL(isDeleted, 0) = 0 ORDER BY UserID
  `);
  console.log('=== ALL USERS ===');
  console.table(allUsers.recordset);

  process.exit(0);
}

main();
