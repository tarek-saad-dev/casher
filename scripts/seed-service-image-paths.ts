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
  // ignore if .env.local is missing
}

async function main() {
  const { getPool } = await import('../src/lib/db');
  const { SERVICE_IMAGE_BY_PRO_NAME } = await import('../src/lib/serviceImages');
  const pool = await getPool();

  console.log('Ensuring TblPro.ImageUrl column exists...');
  await pool.request().query(`
    IF COL_LENGTH(N'dbo.TblPro', N'ImageUrl') IS NULL
    BEGIN
      ALTER TABLE dbo.TblPro
      ADD ImageUrl NVARCHAR(1000) NULL;
    END;
  `);
  console.log('Column ready.');

  let updated = 0;
  let skipped = 0;
  let notFound = 0;

  for (const [proName, imageUrl] of Object.entries(SERVICE_IMAGE_BY_PRO_NAME)) {
    const existing = await pool.request()
      .input('ProName', proName)
      .query(`SELECT ProID, ImageUrl FROM [dbo].[TblPro] WHERE ProName = @ProName`);

    if (existing.recordset.length === 0) {
      console.log(`NOT FOUND: ${proName}`);
      notFound++;
      continue;
    }

    const current = existing.recordset[0].ImageUrl?.trim() || '';
    if (current) {
      console.log(`SKIPPED: ${proName} (already ${current})`);
      skipped++;
      continue;
    }

    await pool.request()
      .input('ProName', proName)
      .input('ImageUrl', imageUrl)
      .query(`UPDATE [dbo].[TblPro] SET ImageUrl = @ImageUrl WHERE ProName = @ProName`);

    console.log(`UPDATED: ${proName} -> ${imageUrl}`);
    updated++;
  }

  console.log(`\nDone. updated=${updated}, skipped=${skipped}, notFound=${notFound}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
