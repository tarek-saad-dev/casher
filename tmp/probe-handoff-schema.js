require('dotenv').config({ path: '.env.local' });
const sql = require('mssql');
(async () => {
  try {
    const pool = await sql.connect({
      server: process.env.LOCAL_DB_SERVER || '127.0.0.1',
      port: Number(process.env.LOCAL_DB_PORT || 14330),
      database: process.env.LOCAL_DB_NAME || 'last132',
      user: process.env.LOCAL_DB_USER,
      password: process.env.LOCAL_DB_PASSWORD,
      options: { encrypt: false, trustServerCertificate: true },
      connectionTimeout: 8000,
      requestTimeout: 8000,
    });
    const r = await pool.request().query(`
      SELECT DB_NAME() AS db,
        (SELECT COUNT(*) FROM sys.tables WHERE name = N'TblBotConversationControlEvent') AS ev,
        COL_LENGTH(N'dbo.TblBotConversation', N'ControlVersion') AS cv,
        COL_LENGTH(N'dbo.TblBotConversation', N'HumanLeaseUntil') AS lease,
        COL_LENGTH(N'dbo.TblBotMessage', N'Origin') AS origin
    `);
    console.log(JSON.stringify(r.recordset[0], null, 2));
    await pool.close();
  } catch (e) {
    console.error('SQL_FAIL', e.message);
    process.exit(1);
  }
})();
