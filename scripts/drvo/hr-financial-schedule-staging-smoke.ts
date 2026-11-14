/**
 * Guarded read-only HR/booking SQL staging smoke. No payroll/attendance writes.
 * Fixed loopback port and dedicated last132_agent/drvo_agent identity.
 */
import sql from 'mssql';

const TARGET_DB = 'last132_agent';
const TARGET_LOGIN = 'drvo_agent';

type SampleRow = {
  IsWorkingDay: boolean | number | null;
  HrStart: string | null;
  DefaultHrStart: string | null;
  BookingStart: string | null;
};

async function smoke(): Promise<void> {
  const password = process.env.DRVO_STAGING_DB_PASSWORD;
  if (!password || process.env.DB_DATABASE !== TARGET_DB || process.env.DB_USER !== TARGET_LOGIN) {
    throw new Error('Staging-only credentials and identity env required; production refused');
  }

  const pool = new sql.ConnectionPool({
    server: '127.0.0.1',
    port: 14330,
    database: TARGET_DB,
    user: TARGET_LOGIN,
    password,
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
    connectionTimeout: 15000,
    requestTimeout: 20000,
  });
  try {
    await pool.connect();
    const id = await pool.request().query(
      "SELECT DB_NAME() AS db, SUSER_SNAME() AS login, IS_SRVROLEMEMBER(N'sysadmin') AS IsSysAdmin"
    );
    const who = id.recordset[0] as { db: string; login: string; IsSysAdmin: number };
    if (who?.db !== TARGET_DB ||
      String(who.login).toLowerCase() !== TARGET_LOGIN ||
      Number(who.IsSysAdmin) !== 0) {
      throw new Error('Database identity or privilege mismatch: refusing staging smoke');
    }
    console.log('Verified safe staging SQL identity:', who.db, who.login);

    // Confirm columns used by the HR financial and booking schedule queries.
    const required: Record<string, string[]> = {
      TblEmp: ['EmpID', 'TenantId', 'EmploymentType', 'isActive', 'DefaultCheckInTime', 'DefaultCheckOutTime'],
      TblEmpWorkSchedule: ['EmpID', 'DayOfWeek', 'IsWorkingDay', 'StartTime', 'EndTime'],
      TblEmpBranchWorkSchedule: ['EmpID', 'BranchID', 'DayOfWeek', 'StartTime', 'EndTime'],
      Location: ['TenantId', 'LegacyBranchId', 'Status'],
    };
    for (const [table, columns] of Object.entries(required)) {
      const res = await pool.request()
        .input('objectName', sql.NVarChar(150), 'dbo.' + table)
        .query('SELECT name FROM sys.columns WHERE object_id = OBJECT_ID(@objectName)');
      const found = new Set(res.recordset.map((row: { name: string }) => row.name.toLowerCase()));
      const missing = columns.filter(name => !found.has(name.toLowerCase()));
      if (missing.length) throw new Error('Missing columns in ' + table + ': ' + missing.join(', '));
      console.log('Required SQL columns:', table, 'PASS');
    }

    // Read real tenant-scoped staging records; never alter data.
    const samples = await pool.request().query([
      'SELECT TOP (50) ws.IsWorkingDay,',
      'CONVERT(VARCHAR(5),ws.StartTime,108) AS HrStart,',
      'CONVERT(VARCHAR(5),e.DefaultCheckInTime,108) AS DefaultHrStart,',
      'CONVERT(VARCHAR(5),bs.BookingStart,108) AS BookingStart',
      'FROM dbo.TblEmp e',
      'INNER JOIN dbo.TblEmpWorkSchedule ws ON ws.EmpID=e.EmpID',
      'OUTER APPLY (SELECT TOP (1) b.StartTime AS BookingStart',
      'FROM dbo.TblEmpBranchWorkSchedule b',
      'WHERE b.EmpID=e.EmpID AND b.DayOfWeek=ws.DayOfWeek ORDER BY b.BranchID) bs',
      'WHERE ISNULL(e.isActive,1)=1 AND e.TenantId IN',
      "(SELECT l.TenantId FROM dbo.Location l WHERE l.Status=N'active')",
      'ORDER BY e.EmpID, ws.DayOfWeek',
    ].join(' '));
    let offDays = 0;
    let differentBookingStarts = 0;
    for (const row of samples.recordset as SampleRow[]) {
      const working = row.IsWorkingDay === true || Number(row.IsWorkingDay) === 1;
      const financialStart = working ? (row.HrStart || row.DefaultHrStart) : null;
      if (!working) offDays++;
      if (working && financialStart && row.BookingStart && row.BookingStart !== financialStart) {
        differentBookingStarts++;
      }
    }
    console.log('Read-only staging sample rows:', samples.recordset.length);
    console.log('HR days off in sample:', offDays);
    console.log('Different booking/HR starts in sample:', differentBookingStarts);
    if (!samples.recordset.length) {
      console.log('NOTE: no HR workday rows found; schema PASS, live data behavior unverified');
    }
    console.log('HR vs booking SQL schema and read-only query: PASS');
  } finally {
    if (pool.connected) await pool.close();
  }
}

smoke().catch(error => {
  console.error('HR staging SQL smoke failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
