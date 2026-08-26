#!/usr/bin/env node
/* eslint-disable */
const fs = require('fs');
const path = require('path');
const sql = require('mssql');

function loadEnv(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (process.env[m[1]] == null) process.env[m[1]] = v;
    }
  } catch (_) {}
}

async function main() {
  loadEnv(path.join(process.cwd(), '.env.local'));
  loadEnv(path.join(process.cwd(), '.env'));
  const pool = await sql.connect({
    server: '127.0.0.1',
    port: 1433,
    database: process.env.DB_DATABASE || process.env.LOCAL_DB_NAME || 'last132',
    user: process.env.DB_USER || process.env.LOCAL_DB_USER,
    password: process.env.DB_PASSWORD || process.env.LOCAL_DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
  });

  const dry = process.argv.includes('--dry-run');
  const confirm = process.argv.includes('--confirm');

  const before = await pool.request().query(`
    SELECT b.BranchID, b.BranchCode, b.LifecycleStatus, b.IsActive,
           b.PublicBookingEnabled, q.BookingEnabled AS QbsBookingEnabled
    FROM dbo.TblBranch b
    LEFT JOIN dbo.QueueBookingSettings q ON q.BranchID = b.BranchID
    WHERE b.BranchCode = N'CAMP_CAESAR'
  `);
  const row = before.recordset[0];
  if (!row) throw new Error('CAMP_CAESAR missing');
  console.log('BEFORE', JSON.stringify(row, null, 2));

  if (String(row.LifecycleStatus) === 'PUBLIC_LIVE' && Boolean(row.PublicBookingEnabled) && Boolean(row.IsActive)) {
    console.log('ALREADY_PUBLIC_LIVE');
    await pool.close();
    return;
  }
  if (String(row.LifecycleStatus) !== 'INTERNAL_LIVE') {
    throw new Error(`Refuse: expected INTERNAL_LIVE, got ${row.LifecycleStatus}`);
  }
  if (dry || !confirm) {
    console.log('Dry-run only. Pass --confirm to promote INTERNAL_LIVE → PUBLIC_LIVE');
    await pool.close();
    return;
  }

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const branchId = Number(row.BranchID);
    await new sql.Request(tx)
      .input('branchId', sql.Int, branchId)
      .query(`
        UPDATE dbo.TblBranch
        SET LifecycleStatus = N'PUBLIC_LIVE',
            IsActive = 1,
            PublicBookingEnabled = 1,
            ExternalNotificationsEnabled = 1,
            UpdatedAt = SYSUTCDATETIME()
        WHERE BranchID = @branchId
          AND BranchCode = N'CAMP_CAESAR'
          AND LifecycleStatus = N'INTERNAL_LIVE'
      `);

    await new sql.Request(tx)
      .input('branchId', sql.Int, branchId)
      .query(`
        UPDATE dbo.QueueBookingSettings
        SET BookingEnabled = 1, UpdatedAt = GETDATE()
        WHERE BranchID = @branchId
      `);

    await new sql.Request(tx)
      .input('branchId', sql.Int, branchId)
      .query(`
        INSERT INTO dbo.TblBranchLifecycleAudit (
          BranchID, FromStatus, ToStatus, Reason, ActorUserID, ReadinessJson
        )
        VALUES (
          @branchId,
          N'INTERNAL_LIVE',
          N'PUBLIC_LIVE',
          N'prod repair: restore public booking discovery for cutsaloon.com',
          0,
          N'{"source":"scripts/_vps-promote-camp-public-live.js"}'
        )
      `);

    await tx.commit();
  } catch (e) {
    try { await tx.rollback(); } catch (_) {}
    throw e;
  }

  const after = await pool.request().query(`
    SELECT b.BranchID, b.BranchCode, b.LifecycleStatus, b.IsActive,
           b.PublicBookingEnabled, q.BookingEnabled AS QbsBookingEnabled
    FROM dbo.TblBranch b
    LEFT JOIN dbo.QueueBookingSettings q ON q.BranchID = b.BranchID
    WHERE b.BranchCode = N'CAMP_CAESAR'
  `);
  console.log('AFTER', JSON.stringify(after.recordset[0], null, 2));
  await pool.close();
}

main().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
