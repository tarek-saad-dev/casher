import { readFileSync } from 'fs';

const envPath = '.env.local';
try {
  const envText = readFileSync(envPath, 'utf8');
  for (const line of envText.split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) {
      let value = match[2].trim();
      value = value.replace(/^["']|["']$/g, '');
      process.env[match[1]] = value;
    }
  }
} catch {
  /* ignore */
}

async function main() {
  const { getPool, sql } = await import('../src/lib/db');
  const { BARBER_NAME_EN_BY_EMP_NAME } = await import('../src/lib/barberImages');
  const { ensureTblEmpNameEnColumn } = await import(
    '../src/lib/migrations/ensureEmployeeNameEn'
  );

  const pool = await getPool();
  console.log('Ensuring TblEmp.EmpNameEn...');
  const ready = await ensureTblEmpNameEnColumn(pool);
  if (!ready) throw new Error('EmpNameEn column unavailable');

  let updated = 0;
  let skipped = 0;
  let notFound = 0;

  for (const [empName, nameEn] of Object.entries(BARBER_NAME_EN_BY_EMP_NAME)) {
    const existing = await pool
      .request()
      .input('EmpName', sql.NVarChar(100), empName)
      .query(`SELECT EmpID, EmpNameEn FROM dbo.TblEmp WHERE EmpName = @EmpName`);

    if (!existing.recordset.length) {
      console.log(`NOT FOUND: ${empName}`);
      notFound++;
      continue;
    }

    for (const row of existing.recordset) {
      const current = String(row.EmpNameEn ?? '').trim();
      if (current) {
        console.log(`SKIPPED: ${empName} (#${row.EmpID}) already ${current}`);
        skipped++;
        continue;
      }
      await pool
        .request()
        .input('EmpID', sql.Int, Number(row.EmpID))
        .input('EmpNameEn', sql.NVarChar(200), nameEn)
        .query(`UPDATE dbo.TblEmp SET EmpNameEn = @EmpNameEn WHERE EmpID = @EmpID`);
      console.log(`UPDATED: ${empName} (#${row.EmpID}) -> ${nameEn}`);
      updated++;
    }
  }

  console.log(`\nDone. updated=${updated}, skipped=${skipped}, notFound=${notFound}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
