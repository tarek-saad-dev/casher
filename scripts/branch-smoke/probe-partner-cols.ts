import Module from 'module';
import { readFileSync } from 'fs';
import { resolve } from 'path';

for (const envPath of ['.env.local', '.env']) {
  try {
    const text = readFileSync(resolve(process.cwd(), envPath), 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    /* */
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const orig = m._load;
m._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

async function main() {
  const { getPool, sql } = await import('../../src/lib/db');
  const cols = await (await getPool())
    .request()
    .query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='TblBranchPartnerShare' ORDER BY ORDINAL_POSITION`,
    );
  console.log(cols.recordset.map((r: { COLUMN_NAME: string }) => r.COLUMN_NAME).join(', '));
  const rows = await (await getPool()).request().input('b', sql.Int, 3).query(`
    SELECT TOP 10 * FROM dbo.TblBranchPartnerShare WHERE BranchID=@b ORDER BY ID DESC
  `);
  console.log(JSON.stringify(rows.recordset, null, 2));
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
