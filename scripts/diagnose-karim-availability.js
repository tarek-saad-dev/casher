require('dotenv').config({ path: '.env.local' });
const sql = require('mssql');

const config = {
  server: process.env.CLOUD_DB_SERVER || process.env.DB_SERVER,
  database: process.env.CLOUD_DB_DATABASE || process.env.DB_DATABASE,
  user: process.env.CLOUD_DB_USER || process.env.DB_USER,
  password: process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  options: {
    encrypt: (process.env.CLOUD_DB_ENCRYPT || process.env.DB_ENCRYPT) === 'true',
    trustServerCertificate:
      (process.env.CLOUD_DB_TRUST_CERT || process.env.DB_TRUST_SERVER_CERTIFICATE) === 'true',
  },
};

async function main() {
  console.log('server set?', Boolean(config.server), 'db set?', Boolean(config.database));
  const pool = await sql.connect(config);
  const emp = await pool.request().query(`
    SELECT EmpID, EmpName FROM dbo.TblEmp
    WHERE EmpName LIKE N'%كريم%' AND ISNULL(isActive,1)=1
  `);
  console.log(emp.recordset);
  const empId = emp.recordset[0].EmpID;

  for (const day of ['2026-07-30', '2026-07-31', '2026-08-01']) {
    console.log('\\n====', day, '====');
    const ovr = await pool
      .request()
      .input('id', sql.Int, empId)
      .input('day', sql.Date, day)
      .query(`
        SELECT Type, Reason, CreatedBy, IsActive,
          CONVERT(VARCHAR(5), StartTime, 108) AS StartTime,
          CONVERT(VARCHAR(5), EndTime, 108) AS EndTime
        FROM dbo.TblEmpScheduleOverrides
        WHERE EmpID=@id AND OverrideDate=@day AND IsActive=1
      `);
    console.log('overrides', ovr.recordset);

    const books = await pool
      .request()
      .input('id', sql.Int, empId)
      .input('day', sql.Date, day)
      .query(`
        SELECT BookingID, Status,
          CONVERT(VARCHAR(5), StartTime, 108) AS StartTime,
          CONVERT(VARCHAR(5), EndTime, 108) AS EndTime
        FROM dbo.Bookings
        WHERE AssignedEmpID=@id AND BookingDate=@day
        ORDER BY StartTime
      `);
    console.log('bookings', books.recordset);

    const att = await pool
      .request()
      .input('id', sql.Int, empId)
      .input('day', sql.Date, day)
      .query(`
        SELECT Status,
          CONVERT(VARCHAR(5), CheckInTime, 108) AS CheckIn,
          CONVERT(VARCHAR(5), CheckOutTime, 108) AS CheckOut
        FROM dbo.TblEmpAttendance WHERE EmpID=@id AND WorkDate=@day
      `);
    console.log('attendance', att.recordset);
  }

  const sched = await pool.request().input('id', sql.Int, empId).query(`
    SELECT DayOfWeek, IsWorking,
      CONVERT(VARCHAR(5), StartTime, 108) AS StartTime,
      CONVERT(VARCHAR(5), EndTime, 108) AS EndTime
    FROM dbo.TblEmpBranchWorkSchedule
    WHERE EmpID=@id AND BranchID=1 AND IsActive=1
      AND EffectiveFrom <= '2026-08-01'
      AND (EffectiveTo IS NULL OR EffectiveTo >= '2026-07-30')
    ORDER BY DayOfWeek
  `);
  console.log('\\nschedule', sched.recordset);
  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
