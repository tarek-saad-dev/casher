#!/usr/bin/env npx tsx
/**
 * Phase 1O — live audit of Camp Caesar vs GLEEM configuration domains.
 */
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import sql from 'mssql';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local'), override: true });

async function main() {
  const pool = await sql.connect({
    server: process.env.CLOUD_DB_SERVER || '',
    port: parseInt(process.env.CLOUD_DB_PORT || '1433', 10),
    database: process.env.CLOUD_DB_NAME || '',
    user: process.env.CLOUD_DB_USER || '',
    password: process.env.CLOUD_DB_PASSWORD || '',
    options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true },
  });

  const branches = await pool.request().query(`
    SELECT BranchID, BranchCode, BranchName, ShortName, Address, Phone, TimeZone,
           CONVERT(varchar(8), DefaultOpenTime, 108) AS DefaultOpenTime,
           CONVERT(varchar(8), DefaultCloseTime, 108) AS DefaultCloseTime,
           CONVERT(varchar(8), BusinessDayCutoffTime, 108) AS BusinessDayCutoffTime,
           LifecycleStatus, IsActive, PublicBookingEnabled, ExternalNotificationsEnabled
    FROM dbo.TblBranch ORDER BY BranchID
  `);

  const qbs = await pool.request().query(`
    SELECT BranchID, SettingID, SalonName, Timezone, BookingEnabled,
           SlotIntervalMinutes, MaxBookingDaysAhead, MinNoticeMinutes,
           DefaultServiceDurationMinutes
    FROM dbo.QueueBookingSettings ORDER BY BranchID
  `);

  const gleemAccess = await pool.request().query(`
    SELECT uba.UserID, u.UserName, uba.CanOperate, uba.CanViewReports, uba.CanSwitch,
           uba.IsActive, ISNULL(u.isDeleted,0) AS isDeleted
    FROM dbo.TblUserBranchAccess uba
    INNER JOIN dbo.TblUser u ON u.UserID = uba.UserID
    WHERE uba.BranchID = 1 AND uba.IsActive = 1
    ORDER BY uba.UserID
  `);

  const ccAccess = await pool.request().query(`
    SELECT uba.UserID, u.UserName, uba.CanOperate, uba.CanViewReports, uba.CanSwitch, uba.IsActive, uba.GrantReason
    FROM dbo.TblUserBranchAccess uba
    INNER JOIN dbo.TblUser u ON u.UserID = uba.UserID
    WHERE uba.BranchID = 3
    ORDER BY uba.UserID
  `);

  const partners = await pool.request().query(`
    SELECT BranchID, PartnerUserID, PartnerCode, PartnerName, SharePercent,
           CONVERT(char(10), EffectiveFrom, 23) AS EffectiveFrom,
           CONVERT(char(10), EffectiveTo, 23) AS EffectiveTo, IsActive
    FROM dbo.TblBranchPartnerShare
    WHERE BranchID IN (1,3)
    ORDER BY BranchID, PartnerName
  `);

  const services = await pool.request().query(`
    SELECT COUNT(*) AS ActiveServ
    FROM dbo.TblPro
    WHERE ISNULL(isDeleted,0)=0 AND LOWER(ISNULL(ProType,N'')) IN (N'serv', N'service')
      AND ISNULL(PPrice,0) > 0
  `);

  const payments = await pool.request().query(`
    SELECT PaymentID, PaymentMethod FROM dbo.TblPaymentMethods ORDER BY PaymentID
  `);

  const assign = await pool.request().query(`
    SELECT BranchID, COUNT(*) AS Cnt FROM dbo.TblEmpBranchAssignment
    WHERE IsActive=1 GROUP BY BranchID
  `);

  const inv = await pool.request().query(`
    SELECT BranchID, COUNT(*) AS Rows, SUM(QtyOnHand) AS Qty
    FROM dbo.TblBranchInventory GROUP BY BranchID
  `);

  const smoke = await pool.request().query(`
    SELECT TOP 3 SmokeRunID, Status, CleanupStatus, Purpose
    FROM dbo.TblBranchSmokeRun WHERE BranchID=3 ORDER BY SmokeRunID DESC
  `);

  const out = {
    at: new Date().toISOString(),
    branches: branches.recordset,
    queueBookingSettings: qbs.recordset,
    gleemAccess: gleemAccess.recordset,
    ccAccess: ccAccess.recordset,
    partners: partners.recordset,
    activePricedServices: services.recordset[0],
    payments: payments.recordset,
    assignments: assign.recordset,
    inventory: inv.recordset,
    recentSmoke: smoke.recordset,
  };

  const p = path.join(__dirname, '_phase1o-live-audit.json');
  fs.writeFileSync(p, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
