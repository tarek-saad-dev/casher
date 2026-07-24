const path = require('path');
const dotenv = require('dotenv');
const { connectReadOnly } = require('./_db.cjs');
dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

(async () => {
  const { pool } = await connectReadOnly();
  const multi = await pool.request().query(`
    SELECT EmpID, COUNT(*) AS c
    FROM dbo.TblEmpAttendance
    WHERE CheckInTime IS NOT NULL AND CheckOutTime IS NULL
    GROUP BY EmpID
    HAVING COUNT(*) > 1
  `);
  const open = await pool.request().query(`
    SELECT COUNT(DISTINCT EmpID) AS emps, COUNT(*) AS rows
    FROM dbo.TblEmpAttendance
    WHERE CheckInTime IS NOT NULL AND CheckOutTime IS NULL
  `);
  console.log(JSON.stringify({
    multiOpenEmpCount: multi.recordset.length,
    samples: multi.recordset.slice(0, 15),
    open: open.recordset[0],
  }, null, 2));
  await pool.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
