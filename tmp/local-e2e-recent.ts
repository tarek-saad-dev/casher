import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const orig = mod._load;
mod._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return orig.call(this, r, ...rest);
};

async function main() {
  const { getPool, closePool } = await import('../src/lib/db');
  const p = await getPool();
  const inbox = await p.request().query(`
    SELECT TOP 10 ID, Provider, LEFT(ProviderMessageID, 40) AS pmid,
      LEFT(Phone, 6) AS phone, LEFT(ISNULL(Text, N''), 100) AS text,
      Status, CreatedAt
    FROM dbo.TblMessageInbox ORDER BY ID DESC
  `);
  const ai = await p.request().query(`
    SELECT TOP 5 TurnID, Status, Intent, CreatedAt, ErrorCode
    FROM dbo.TblBotAiTurn ORDER BY TurnID DESC
  `);
  console.log(JSON.stringify({ inbox: inbox.recordset, ai: ai.recordset }, null, 2));
  await closePool();
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});
