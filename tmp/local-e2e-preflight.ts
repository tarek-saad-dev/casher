/**
 * Local E2E preflight: DB topology + messaging schema + baseline counts.
 * Never prints secrets.
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const origLoad = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, ...rest);
};

async function main() {
  const { getCurrentDbTarget, getDbConnectionInfo, getPool, closePool } = await import(
    '../src/lib/db'
  );
  const target = getCurrentDbTarget();
  const info = getDbConnectionInfo();
  const resolved = target === 'local' ? info.local : info.cloud;
  console.log(
    JSON.stringify(
      {
        target,
        server: resolved.server,
        port: resolved.port,
        database: resolved.database,
        geminiKeySet: Boolean(String(process.env.GEMINI_API_KEY || '').trim()),
        geminiModel: String(process.env.GEMINI_MODEL || '').trim() || 'gemini-2.0-flash',
        inboxTokenSet: Boolean(String(process.env.WHATSAPP_INBOX_WEBHOOK_TOKEN || '').trim()),
        waBase: String(process.env.WHATSAPP_API_BASE_URL || ''),
        waEnabled: String(process.env.WHATSAPP_INTEGRATION_ENABLED || ''),
      },
      null,
      2,
    ),
  );

  const pool = await getPool();
  const schema = await pool.request().query(`
    SELECT
      DB_NAME() AS db,
      CASE WHEN OBJECT_ID(N'dbo.TblMessageInbox') IS NULL THEN 0 ELSE 1 END AS inbox,
      CASE WHEN OBJECT_ID(N'dbo.TblBotConversation') IS NULL THEN 0 ELSE 1 END AS conv,
      CASE WHEN OBJECT_ID(N'dbo.TblBotMessage') IS NULL THEN 0 ELSE 1 END AS msg,
      CASE WHEN OBJECT_ID(N'dbo.TblBotAiTurn') IS NULL THEN 0 ELSE 1 END AS ai,
      CASE WHEN OBJECT_ID(N'dbo.TblMessageOutbox') IS NULL THEN 0 ELSE 1 END AS outbox
  `);
  console.log('schema', schema.recordset[0]);

  const counts = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.TblMessageInbox) AS inboxCount,
      (SELECT COUNT(*) FROM dbo.TblBotConversation) AS convCount,
      (SELECT COUNT(*) FROM dbo.TblBotMessage) AS msgCount,
      (SELECT CASE WHEN OBJECT_ID(N'dbo.TblBotAiTurn') IS NULL THEN -1 ELSE (SELECT COUNT(*) FROM dbo.TblBotAiTurn) END) AS aiCount,
      (SELECT COUNT(*) FROM dbo.TblMessageOutbox) AS outboxCount,
      SYSUTCDATETIME() AS baselineUtc
  `);
  console.log('baseline', counts.recordset[0]);
  await closePool();
}

main().catch((e) => {
  console.error('FAIL', e instanceof Error ? e.message : e);
  process.exit(2);
});
