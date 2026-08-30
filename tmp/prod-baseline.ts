#!/usr/bin/env npx tsx
import path from "path";
import Module from "module";
import dotenv from "dotenv";
const appRoot = "/home/casher/app";
dotenv.config({ path: path.join(appRoot, ".env.local"), override: true });
const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const orig = mod._load;
mod._load = function (r: string, ...rest: unknown[]) {
  if (r === "server-only") return {};
  return orig.call(this, r, ...rest);
};
async function main() {
  const { getCurrentDbTarget, getDbConnectionInfo, getPool, closePool } = await import(path.join(appRoot, "src/lib/db.ts"));
  const target = getCurrentDbTarget();
  const info = getDbConnectionInfo();
  const resolved = target === "local" ? info.local : info.cloud;
  console.log(JSON.stringify({ target, server: resolved.server, port: (resolved as any).port ?? null, database: resolved.database }, null, 2));
  const pool = await getPool();
  const q = await pool.request().query(`
    SELECT DB_NAME() AS db, @@SERVERNAME AS serverName,
      (SELECT COUNT(*) FROM dbo.TblMessageInbox) AS inboxCount,
      (SELECT COUNT(*) FROM dbo.TblBotConversation) AS convCount,
      (SELECT COUNT(*) FROM dbo.TblBotMessage) AS msgCount,
      (SELECT CASE WHEN OBJECT_ID(N'dbo.TblBotAiTurn') IS NULL THEN -1 ELSE (SELECT COUNT(*) FROM dbo.TblBotAiTurn) END) AS aiCount,
      (SELECT COUNT(*) FROM dbo.TblMessageOutbox) AS outboxCount,
      SYSUTCDATETIME() AS baselineUtc
  `);
  console.log("baseline", JSON.stringify(q.recordset[0]));
  await closePool();
}
main().catch((e) => { console.error("FAIL", e instanceof Error ? e.message : e); process.exit(2); });