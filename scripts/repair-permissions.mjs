// Idempotent repair script for permissions DB
// Fixes wrong AccessMode and wrong role assignments based on pages-registry defaults
// Run with: node scripts/repair-permissions.mjs

import sql from 'mssql';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const config = {
  server:   process.env.CLOUD_DB_SERVER   || process.env.DB_SERVER   || '',
  port:     parseInt(process.env.CLOUD_DB_PORT || process.env.DB_PORT || '1433', 10),
  database: process.env.CLOUD_DB_NAME     || process.env.DB_DATABASE || 'HawaiRestaurant',
  user:     process.env.CLOUD_DB_USER     || process.env.DB_USER     || '',
  password: process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD || '',
  options: { encrypt: true, trustServerCertificate: process.env.CLOUD_DB_TRUST_CERT === 'true', enableArithAbort: true },
  connectionTimeout: 30000, requestTimeout: 30000,
};

// ── Source of truth: who can see what ────────────────────────────────────────
// Format: { pageKey, accessMode, allowedRoles }
// allowedRoles = [] means only super_admin (for super_admin_only pages)
const PAGE_ACCESS_RULES = [
  // POS / Income
  { pageKey: 'income.pos',              accessMode: 'roles', allowedRoles: ['super_admin','admin','manager','cashier'] },
  { pageKey: 'income.new',              accessMode: 'roles', allowedRoles: ['super_admin','admin','cashier'] },
  // Sales review
  { pageKey: 'sales.today',             accessMode: 'roles', allowedRoles: ['super_admin','admin','manager','cashier','viewer'] },
  { pageKey: 'income_review.all_sales', accessMode: 'roles', allowedRoles: ['super_admin','admin','manager','viewer'] },
  { pageKey: 'income_review.today_rev', accessMode: 'roles', allowedRoles: ['super_admin','admin','manager','cashier','viewer'] },
  { pageKey: 'income_review.all_rev',   accessMode: 'roles', allowedRoles: ['super_admin','admin','accountant'] },
  { pageKey: 'income_review.payments',  accessMode: 'roles', allowedRoles: ['super_admin','admin','accountant'] },
  // Reports — cashier NOT included
  { pageKey: 'reports.emp_services',    accessMode: 'roles', allowedRoles: ['super_admin','admin','manager'] },
  { pageKey: 'reports.emp_monthly_work_revenue', accessMode: 'roles', allowedRoles: ['super_admin','admin','manager'] },
  { pageKey: 'reports.monthly',         accessMode: 'roles', allowedRoles: ['super_admin','admin','manager','accountant','viewer'] },
  // Expenses
  { pageKey: 'expenses.new',            accessMode: 'roles', allowedRoles: ['super_admin','admin','cashier','accountant'] },
  { pageKey: 'reports.expenses',        accessMode: 'roles', allowedRoles: ['super_admin','admin','manager','accountant'] },
  // Treasury — cashier CANNOT see treasury.daily (has own cashier_treasury_daily)
  { pageKey: 'treasury.daily',          accessMode: 'roles', allowedRoles: ['super_admin','admin','accountant'] },
  { pageKey: 'cashier_treasury_daily',  accessMode: 'roles', allowedRoles: ['super_admin','cashier','admin','manager'] },
  { pageKey: 'treasury.period_summary', accessMode: 'roles', allowedRoles: ['super_admin','admin','manager','accountant','viewer'] },
  { pageKey: 'treasury.movement',       accessMode: 'roles', allowedRoles: ['super_admin','admin','accountant','viewer'] },
  { pageKey: 'treasury.summary',        accessMode: 'roles', allowedRoles: ['super_admin','admin','accountant'] },
  { pageKey: 'treasury.shift_close',    accessMode: 'roles', allowedRoles: ['super_admin','admin','accountant'] },
  { pageKey: 'treasury.monthly_close',  accessMode: 'roles', allowedRoles: ['super_admin','admin','accountant'] },
  // Budget
  { pageKey: 'budget.main',             accessMode: 'roles', allowedRoles: ['super_admin','admin','accountant'] },
  // Queue
  { pageKey: 'queue.live',              accessMode: 'roles', allowedRoles: ['super_admin','admin','manager','cashier','receptionist'] },
  { pageKey: 'queue.new',               accessMode: 'roles', allowedRoles: ['super_admin','admin','cashier','receptionist'] },
  // Bookings
  { pageKey: 'bookings.list',           accessMode: 'roles', allowedRoles: ['super_admin','admin','manager','cashier','receptionist'] },
  { pageKey: 'bookings.new',            accessMode: 'roles', allowedRoles: ['super_admin','admin','cashier','receptionist'] },
  { pageKey: 'bookings.calendar',       accessMode: 'roles', allowedRoles: ['super_admin','admin','manager','receptionist'] },
  // HR — cashier NOT included
  { pageKey: 'hr.employees',            accessMode: 'roles', allowedRoles: ['super_admin','admin'] },
  { pageKey: 'hr.attendance',           accessMode: 'roles', allowedRoles: ['super_admin','admin','manager'] },
  { pageKey: 'hr.payroll',              accessMode: 'roles', allowedRoles: ['super_admin','admin','manager'] },
  { pageKey: 'hr.advances',             accessMode: 'roles', allowedRoles: ['super_admin','admin'] },
  { pageKey: 'hr.salaries',             accessMode: 'roles', allowedRoles: ['super_admin','admin'] },
  // Admin — cashier NOT included
  { pageKey: 'admin.operations',        accessMode: 'roles', allowedRoles: ['super_admin','admin','manager'] },
  { pageKey: 'admin.users',             accessMode: 'roles', allowedRoles: ['super_admin','admin'] },
  { pageKey: 'admin.services',          accessMode: 'roles', allowedRoles: ['super_admin','admin'] },
  { pageKey: 'admin.payment_methods',   accessMode: 'roles', allowedRoles: ['super_admin','admin'] },
  { pageKey: 'admin.categories',        accessMode: 'roles', allowedRoles: ['super_admin','admin'] },
  { pageKey: 'admin.loyalty',           accessMode: 'roles', allowedRoles: ['super_admin','admin'] },
  { pageKey: 'admin.shift',             accessMode: 'roles', allowedRoles: ['super_admin','admin'] },
  { pageKey: 'admin.settings',          accessMode: 'roles', allowedRoles: ['super_admin','admin'] },
  { pageKey: 'admin.queue_settings',    accessMode: 'roles', allowedRoles: ['super_admin','admin'] },
  // Special
  { pageKey: 'operations.main',         accessMode: 'all',   allowedRoles: [] },
  { pageKey: 'cut_club.main',           accessMode: 'roles', allowedRoles: ['super_admin','admin'] },
  // Audit
  { pageKey: 'audit.payment_methods',   accessMode: 'roles', allowedRoles: ['super_admin','admin'] },
  // Permissions (super_admin_only — no roles needed)
  { pageKey: 'admin.permissions.users', accessMode: 'super_admin_only', allowedRoles: [] },
  { pageKey: 'admin.permissions.pages', accessMode: 'super_admin_only', allowedRoles: [] },
  { pageKey: 'admin_approvals',         accessMode: 'super_admin_only', allowedRoles: [] },
];

async function repair(db) {
  console.log('▶ Starting permissions repair...\n');

  // Build role cache
  const rolesRes = await db.request().query(`SELECT RoleID, RoleKey FROM dbo.TblRoles WHERE IsActive=1`);
  const roleMap = {};
  for (const r of rolesRes.recordset) roleMap[r.RoleKey] = r.RoleID;

  let fixed = 0; let skipped = 0; let notFound = 0;

  for (const rule of PAGE_ACCESS_RULES) {
    const pidRes = await db.request()
      .input('key', sql.NVarChar, rule.pageKey)
      .query(`SELECT PageID, AccessMode FROM dbo.TblSystemPages WHERE PageKey=@key`);

    if (!pidRes.recordset.length) {
      console.log(`  ⚠ NOT FOUND: ${rule.pageKey}`);
      notFound++;
      continue;
    }

    const { PageID: pageID, AccessMode: currentMode } = pidRes.recordset[0];

    // 1. Fix AccessMode if wrong
    if (currentMode !== rule.accessMode) {
      await db.request()
        .input('mode', sql.NVarChar, rule.accessMode)
        .input('pid',  sql.Int,      pageID)
        .query(`UPDATE dbo.TblSystemPages SET AccessMode=@mode WHERE PageID=@pid`);
      console.log(`  ✓ Fixed AccessMode for "${rule.pageKey}": ${currentMode} → ${rule.accessMode}`);
      fixed++;
    }

    // 2. Delete ALL current role access entries for this page
    await db.request().input('pid', sql.Int, pageID)
      .query(`DELETE FROM dbo.TblPageRoleAccess WHERE PageID=@pid`);

    // 3. Re-insert only the correct roles (excluding super_admin — handled by isSuperAdmin flag)
    const rolesToInsert = rule.allowedRoles.filter(rk => rk !== 'super_admin');
    for (const roleKey of rolesToInsert) {
      const roleID = roleMap[roleKey];
      if (!roleID) { console.log(`    ⚠ Role not found: ${roleKey}`); continue; }
      await db.request()
        .input('pid', sql.Int, pageID)
        .input('rid', sql.Int, roleID)
        .query(`
          INSERT INTO dbo.TblPageRoleAccess (PageID, RoleID, CanView, CanEdit, CanDelete)
          VALUES (@pid, @rid, 1, 0, 0)
        `);
    }

    const roleDisplay = rolesToInsert.length ? rolesToInsert.join(', ') : '(none — super_admin only)';
    console.log(`  ✓ ${rule.pageKey} [${rule.accessMode}] → roles: ${roleDisplay}`);
  }

  console.log(`\n✅ Repair complete. Fixed: ${fixed} | Skipped: ${skipped} | Not found: ${notFound}`);
}

async function verify(db) {
  console.log('\n▶ Verification — Cashier access check:');
  // Find all cashier users
  const cashierUsers = await db.request().query(`
    SELECT u.UserID, u.UserName, r.RoleKey
    FROM dbo.TblUser u
    JOIN dbo.TblUserRoles ur ON ur.UserID = u.UserID
    JOIN dbo.TblRoles r      ON r.RoleID  = ur.RoleID
    WHERE r.RoleKey = 'cashier' AND u.isDeleted = 0
  `);

  if (!cashierUsers.recordset.length) {
    console.log('  No cashier users found.');
    return;
  }

  for (const cu of cashierUsers.recordset) {
    // Check if cashier can see emp_services
    const check = await db.request()
      .input('uid', sql.Int, cu.UserID)
      .query(`
        SELECT sp.PageKey, sp.PagePath, sp.AccessMode
        FROM dbo.TblPageRoleAccess pra
        JOIN dbo.TblSystemPages sp ON sp.PageID = pra.PageID
        JOIN dbo.TblUserRoles ur   ON ur.RoleID = pra.RoleID
        WHERE ur.UserID = @uid AND sp.PageKey IN (
          'reports.emp_services','reports.emp_monthly_work_revenue','hr.employees','hr.attendance',
          'hr.payroll','admin.settings','admin.users','admin.permissions.users',
          'treasury.daily'
        ) AND pra.CanView = 1
      `);
    if (check.recordset.length > 0) {
      console.log(`  ❌ ${cu.UserName} (cashier) still has access to:`);
      check.recordset.forEach((p) => console.log(`     - ${p.PageKey} (${p.PagePath})`));
    } else {
      console.log(`  ✅ ${cu.UserName} (cashier) — no sensitive page access`);
    }

    // Also verify cashier CAN see cashier_treasury_daily
    const cashierTreasury = await db.request()
      .input('uid2', sql.Int, cu.UserID)
      .query(`
        SELECT sp.PageKey FROM dbo.TblPageRoleAccess pra
        JOIN dbo.TblSystemPages sp ON sp.PageID = pra.PageID
        JOIN dbo.TblUserRoles ur   ON ur.RoleID = pra.RoleID
        WHERE ur.UserID = @uid2 AND sp.PageKey = 'cashier_treasury_daily' AND pra.CanView = 1
      `);
    if (cashierTreasury.recordset.length > 0) {
      console.log(`  ✅ ${cu.UserName} (cashier) — can access cashier_treasury_daily ✓`);
    } else {
      console.log(`  ⚠️ ${cu.UserName} (cashier) — MISSING cashier_treasury_daily access`);
    }
  }
}

async function main() {
  console.log('Connecting...');
  const pool = await new sql.ConnectionPool(config).connect();
  console.log('Connected ✓\n');
  await repair(pool);
  await verify(pool);
  await pool.close();
  console.log('\nDone!');
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
