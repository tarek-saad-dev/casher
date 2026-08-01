require('dotenv').config({ path: '.env.local' });
const sql = require('mssql');

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: +(process.env.DB_PORT || 1433),
    options: {
      encrypt: process.env.DB_ENCRYPT === 'true',
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    },
  });

  const thu = await pool.request().query(`
    SELECT ScheduleID, DayOfWeek, IsWorking, EffectiveFrom, EffectiveTo,
      CONVERT(VARCHAR(5),StartTime,108) S, CONVERT(VARCHAR(5),EndTime,108) E
    FROM dbo.TblEmpBranchWorkSchedule
    WHERE EmpID=5 AND BranchID=1 AND DayOfWeek IN (4,5) AND IsActive=1
    ORDER BY DayOfWeek, EffectiveFrom DESC, ScheduleID DESC
  `);
  console.log('Thu/Fri schedule rows:', thu.recordset);

  // Queue on Jul 30-31 for Karim
  for (const day of ['2026-07-30', '2026-07-31']) {
    try {
      const q = await pool.request().input('day', sql.Date, day).query(`
        SELECT QueueTicketID, Status, DurationMinutes, EmpID,
          CONVERT(VARCHAR(8), EstimatedStartTime, 108) Est,
          CONVERT(VARCHAR(8), ServiceStartedAt, 108) Started,
          CONVERT(VARCHAR(8), CreatedAt, 108) Created
        FROM dbo.QueueTickets
        WHERE EmpID=5 AND QueueDate=@day
        ORDER BY QueueTicketID
      `);
      console.log('queue', day, q.recordset);
    } catch (e) {
      console.log('queue err', day, e.message);
    }
  }

  // Service id for haircut
  const svc = await pool.request().query(`
    SELECT TOP 5 ProID, ProName, DurationMinutes
    FROM dbo.TblPro
    WHERE ProName LIKE N'%حلاق%' OR ProName LIKE N'%شعر%' OR ProName LIKE N'%Hair%'
  `).catch(() => ({ recordset: [] }));
  console.log('services sample', svc.recordset);

  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
