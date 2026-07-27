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
  const { getPool } = await import('../../src/lib/db');
  const db = await getPool();
  const c = await db.request().query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME='TblEmpAttendance' ORDER BY ORDINAL_POSITION
  `);
  console.log(c.recordset.map((x: { COLUMN_NAME: string }) => x.COLUMN_NAME).join(', '));
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
