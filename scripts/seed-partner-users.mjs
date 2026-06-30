/**
 * Idempotent seed for partner user accounts.
 *
 * Usage:
 *   PARTNER_USER_MR_ZIAD_PASSWORD=... \
 *   PARTNER_USER_MR_ALI_PASSWORD=... \
 *   PARTNER_USER_MR_MOHAMED_PASSWORD=... \
 *   node scripts/seed-partner-users.mjs
 *
 * Creates users only when missing. Assigns the `partner` role only.
 * Does not overwrite existing passwords.
 */

import sql from 'mssql';

const PARTNER_USERS = [
  {
    loginName: 'mr.ziad',
    userName: 'mr.ziad',
    passwordEnv: 'PARTNER_USER_MR_ZIAD_PASSWORD',
  },
  {
    loginName: 'mr.ali',
    userName: 'mr.ali',
    passwordEnv: 'PARTNER_USER_MR_ALI_PASSWORD',
  },
  {
    loginName: 'mr.mohamed',
    userName: 'mr.mohamed',
    passwordEnv: 'PARTNER_USER_MR_MOHAMED_PASSWORD',
  },
];

function getConfig() {
  const server = process.env.DB_SERVER || process.env.SQL_SERVER || 'localhost';
  const database = process.env.DB_NAME || process.env.SQL_DATABASE;
  const user = process.env.DB_USER || process.env.SQL_USER;
  const password = process.env.DB_PASSWORD || process.env.SQL_PASSWORD;

  if (!database) {
    throw new Error('Set DB_NAME or SQL_DATABASE');
  }

  return {
    server,
    database,
    user,
    password,
    options: {
      encrypt: process.env.DB_ENCRYPT !== 'false',
      trustServerCertificate: process.env.DB_TRUST_CERT === 'true',
    },
  };
}

async function ensurePartnerRole(pool) {
  await pool.request()
    .input('key', 'partner')
    .input('name', 'شريك')
    .input('desc', 'عرض تقرير الشركاء فقط')
    .query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.TblRoles WHERE RoleKey = @key)
        INSERT INTO dbo.TblRoles (RoleKey, RoleName, Description, IsActive)
        VALUES (@key, @name, @desc, 1)
      ELSE
        UPDATE dbo.TblRoles
        SET RoleName = @name, Description = @desc, IsActive = 1
        WHERE RoleKey = @key
    `);
}

async function assignPartnerRole(pool, userId) {
  await pool.request()
    .input('uid', userId)
    .query(`
      DECLARE @rid INT = (SELECT RoleID FROM dbo.TblRoles WHERE RoleKey = 'partner' AND IsActive = 1)
      IF @rid IS NOT NULL
      BEGIN
        DELETE FROM dbo.TblUserRoles
        WHERE UserID = @uid
          AND RoleID IN (SELECT RoleID FROM dbo.TblRoles WHERE RoleKey <> 'partner')

        IF NOT EXISTS (SELECT 1 FROM dbo.TblUserRoles WHERE UserID = @uid AND RoleID = @rid)
          INSERT INTO dbo.TblUserRoles (UserID, RoleID) VALUES (@uid, @rid)
      END
    `);
}

async function main() {
  const pool = await sql.connect(getConfig());

  try {
    await ensurePartnerRole(pool);

    for (const partner of PARTNER_USERS) {
      const existing = await pool.request()
        .input('loginName', partner.loginName)
        .query(`
          SELECT UserID FROM dbo.TblUser
          WHERE loginName = @loginName AND isDeleted = 0
        `);

      if (existing.recordset.length > 0) {
        const userId = existing.recordset[0].UserID;
        await assignPartnerRole(pool, userId);
        console.log(`[seed-partner-users] ${partner.loginName}: exists — partner role ensured`);
        continue;
      }

      const plainPassword = process.env[partner.passwordEnv];
      if (!plainPassword) {
        console.warn(
          `[seed-partner-users] ${partner.loginName}: skipped — set ${partner.passwordEnv} to create account`
        );
        continue;
      }

      const insert = await pool.request()
        .input('loginName', partner.loginName)
        .input('userName', partner.userName)
        .input('password', plainPassword)
        .query(`
          INSERT INTO dbo.TblUser (UserName, loginName, Password, UserLevel, ShiftID, isDeleted)
          OUTPUT INSERTED.UserID
          VALUES (@userName, @loginName, @password, 'user', 1, 0)
        `);

      const userId = insert.recordset[0].UserID;
      await assignPartnerRole(pool, userId);
      console.log(`[seed-partner-users] ${partner.loginName}: created with partner role`);
    }
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error('[seed-partner-users] failed:', err.message || err);
  process.exit(1);
});
