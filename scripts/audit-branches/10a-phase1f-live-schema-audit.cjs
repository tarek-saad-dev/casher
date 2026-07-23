/**
 * Phase 1F live schema audit for Bookings / Queue (read-only).
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { connectReadOnly } = require('./_db.cjs');

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

async function main() {
  const { pool, target, database } = await connectReadOnly();
  try {
    if (database !== 'last132') throw new Error(`Expected last132, got ${database}`);

    const cols = await pool.request().query(`
      SELECT t.name AS table_name, c.name AS column_name, ty.name AS type_name, c.is_nullable
      FROM sys.columns c
      INNER JOIN sys.tables t ON t.object_id = c.object_id
      INNER JOIN sys.types ty ON ty.user_type_id = c.user_type_id
      WHERE t.name IN (
        N'Bookings', N'BookingServices', N'QueueTickets', N'QueueTicketServices',
        N'QueueTicketHistory', N'QueueBookingSettings'
      )
      ORDER BY t.name, c.column_id
    `);

    const indexes = await pool.request().query(`
      SELECT t.name AS table_name, i.name AS index_name, i.is_unique, i.is_primary_key,
             STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) AS columns
      FROM sys.indexes i
      INNER JOIN sys.tables t ON t.object_id = i.object_id
      INNER JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
      INNER JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      WHERE t.name IN (N'Bookings', N'QueueTickets', N'QueueBookingSettings')
        AND i.name IS NOT NULL
      GROUP BY t.name, i.name, i.is_unique, i.is_primary_key
      ORDER BY t.name, i.name
    `);

    const fks = await pool.request().query(`
      SELECT fk.name, OBJECT_NAME(fk.parent_object_id) AS parent_table,
             OBJECT_NAME(fk.referenced_object_id) AS ref_table
      FROM sys.foreign_keys fk
      WHERE OBJECT_NAME(fk.parent_object_id) IN (
        N'Bookings', N'BookingServices', N'QueueTickets', N'QueueTicketServices',
        N'QueueTicketHistory', N'QueueBookingSettings'
      )
      OR OBJECT_NAME(fk.referenced_object_id) IN (
        N'Bookings', N'QueueTickets', N'QueueBookingSettings'
      )
    `);

    const counts = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.Bookings) AS BookingsCount,
        (SELECT COUNT(*) FROM dbo.BookingServices) AS BookingServicesCount,
        (SELECT COUNT(*) FROM dbo.QueueTickets) AS QueueTicketsCount,
        (SELECT COUNT(*) FROM dbo.QueueTicketHistory) AS QueueHistoryCount,
        (SELECT COUNT(*) FROM dbo.QueueBookingSettings) AS SettingsCount,
        (SELECT COUNT(*) FROM dbo.Bookings WHERE BookingCode IS NULL) AS NullBookingCodes,
        (SELECT COUNT(*) FROM (
           SELECT BookingCode FROM dbo.Bookings WHERE BookingCode IS NOT NULL
           GROUP BY BookingCode HAVING COUNT(*) > 1
         ) d) AS DupBookingCodes,
        (SELECT COUNT(*) FROM (
           SELECT TicketCode, QueueDate FROM dbo.QueueTickets
           GROUP BY TicketCode, QueueDate HAVING COUNT(*) > 1
         ) d) AS DupTicketCodeDate
    `);

    const ct = await pool.request().query(`
      SELECT OBJECT_NAME(object_id) AS table_name
      FROM sys.change_tracking_tables
      WHERE OBJECT_NAME(object_id) IN (
        N'Bookings', N'QueueTickets', N'QueueBookingSettings', N'BookingServices'
      )
    `);

    const hasQts = await pool.request().query(`
      SELECT CASE WHEN OBJECT_ID(N'dbo.QueueTicketServices', N'U') IS NULL THEN 0 ELSE 1 END AS exists_flag
    `);

    let qtsCount = 0;
    if (hasQts.recordset[0].exists_flag) {
      const r = await pool.request().query(`SELECT COUNT(*) AS c FROM dbo.QueueTicketServices`);
      qtsCount = r.recordset[0].c;
    }

    const payload = {
      capturedAt: new Date().toISOString(),
      target,
      database,
      counts: { ...counts.recordset[0], QueueTicketServicesCount: qtsCount },
      columns: cols.recordset,
      indexes: indexes.recordset,
      foreignKeys: fks.recordset,
      changeTracking: ct.recordset,
      branchIdPresent: {
        Bookings: cols.recordset.some((c) => c.table_name === 'Bookings' && c.column_name === 'BranchID'),
        QueueTickets: cols.recordset.some((c) => c.table_name === 'QueueTickets' && c.column_name === 'BranchID'),
        QueueBookingSettings: cols.recordset.some(
          (c) => c.table_name === 'QueueBookingSettings' && c.column_name === 'BranchID',
        ),
      },
    };

    const out = path.join(__dirname, '_phase1f-live-schema-audit.json');
    fs.writeFileSync(out, JSON.stringify(payload, null, 2), 'utf8');
    console.log(
      JSON.stringify(
        {
          out: path.relative(process.cwd(), out),
          counts: payload.counts,
          branchIdPresent: payload.branchIdPresent,
          changeTracking: payload.changeTracking,
          uniqueIndexes: payload.indexes.filter((i) => i.is_unique),
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
