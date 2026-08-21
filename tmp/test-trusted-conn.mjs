import sql from 'mssql/msnodesqlv8.js';
import fs from 'fs';

const candidates = [
  String.raw`Driver={ODBC Driver 17 for SQL Server};Server=Tarek\SQLEXPRESS;Database=HawaiBookingV2Isolated;Trusted_Connection=Yes;TrustServerCertificate=Yes;`,
  String.raw`Driver={ODBC Driver 17 for SQL Server};Server=.\SQLEXPRESS;Database=HawaiBookingV2Isolated;Trusted_Connection=Yes;TrustServerCertificate=Yes;`,
  String.raw`Driver={ODBC Driver 17 for SQL Server};Server=(local)\SQLEXPRESS;Database=HawaiBookingV2Isolated;Trusted_Connection=Yes;TrustServerCertificate=Yes;`,
  String.raw`Driver={SQL Server Native Client RDA 11.0};Server=Tarek\SQLEXPRESS;Database=HawaiBookingV2Isolated;Trusted_Connection=Yes;`,
  String.raw`Driver={SQL Server};Server=Tarek\SQLEXPRESS;Database=HawaiBookingV2Isolated;Trusted_Connection=Yes;`,
  // TCP if SQL Browser / static port known
  String.raw`Driver={ODBC Driver 17 for SQL Server};Server=localhost,1433;Database=HawaiBookingV2Isolated;Trusted_Connection=Yes;TrustServerCertificate=Yes;`,
];

const out = [];
for (const cs of candidates) {
  try {
    const pool = await new sql.ConnectionPool({
      connectionString: cs,
      connectionTimeout: 8000,
      requestTimeout: 8000,
    }).connect();
    const r = await pool.request().query('SELECT DB_NAME() AS db, SUSER_SNAME() AS login');
    out.push({ ok: true, cs, row: r.recordset[0] });
    await pool.close();
    break;
  } catch (e) {
    out.push({ ok: false, cs, error: String(e.message || e).slice(0, 220) });
  }
}
fs.writeFileSync('tmp/trusted-conn-test.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
