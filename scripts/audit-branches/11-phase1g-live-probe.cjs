/** Phase 1G live probe — TblBranch uniqueness + settings columns. */
const path = require('path');
const dotenv = require('dotenv');
const { connectReadOnly } = require('./_db.cjs');

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

async function main() {
  const { pool, database } = await connectReadOnly();
  try {
    const u = await pool.request().query(`
      SELECT i.name AS index_name,
             STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) AS columns
      FROM sys.indexes i
      INNER JOIN sys.tables t ON t.object_id = i.object_id
      INNER JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
      INNER JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      WHERE t.name = N'TblBranch' AND i.is_unique = 1
      GROUP BY i.name
      ORDER BY i.name
    `);
    const partners = await pool.request().query(`
      SELECT s.PartnerCode, s.PartnerName, s.SharePercent, s.EffectiveFrom, s.EffectiveTo
      FROM dbo.TblBranchPartnerShare s
      INNER JOIN dbo.TblBranch b ON b.BranchID = s.BranchID
      WHERE b.BranchCode = N'GLEEM'
        AND s.IsActive = 1
        AND (s.EffectiveTo IS NULL OR s.EffectiveTo >= CAST(SYSUTCDATETIME() AS date))
      ORDER BY s.PartnerCode
    `);
    const settingsCols = await pool.request().query(`
      SELECT c.name
      FROM sys.columns c
      WHERE c.object_id = OBJECT_ID(N'dbo.QueueBookingSettings')
      ORDER BY c.column_id
    `);
    const gleemSettings = await pool.request().query(`
      SELECT s.SettingID, s.BranchID, s.SalonName, s.Timezone, s.BookingEnabled, s.SlotIntervalMinutes
      FROM dbo.QueueBookingSettings s
      INNER JOIN dbo.TblBranch b ON b.BranchID = s.BranchID
      WHERE b.BranchCode = N'GLEEM'
    `);
    console.log(
      JSON.stringify(
        {
          database,
          uniques: u.recordset,
          settingsCols: settingsCols.recordset.map((r) => r.name),
          gleemPartners: partners.recordset,
          gleemSettings: gleemSettings.recordset,
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
