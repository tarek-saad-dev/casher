#!/usr/bin/env npx tsx
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const origLoad = mod._load;
mod._load = function patchedLoad(request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, ...rest);
};

async function main() {
  const {
    getPool,
    getDbConnectionInfo,
    getCurrentDbTarget,
    closePool,
  } = await import('../src/lib/db');

  const target = getCurrentDbTarget();
  const info = getDbConnectionInfo();
  const resolved = target === 'local' ? info.local : info.cloud;
  console.log('DRVOWA integration migration');
  console.log(`  runtime target: ${target}`);
  console.log(`  server: ${resolved.server}`);
  console.log(`  database: ${resolved.database}`);

  const pool = await getPool();
  const dbName = await pool.request().query(`SELECT DB_NAME() AS name`);
  const liveName = String(dbName.recordset[0]?.name || '');
  if (liveName.toLowerCase() !== 'last132') {
    throw new Error(`Refusing unexpected live database: ${liveName}`);
  }

  await pool.request().batch(`
    IF OBJECT_ID(N'dbo.TblDrvowaIntegrationConfig', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.TblDrvowaIntegrationConfig (
        ConfigID INT NOT NULL CONSTRAINT PK_TblDrvowaIntegrationConfig PRIMARY KEY,
        DrvowaBaseUrl NVARCHAR(500) NOT NULL,
        InboundApiKeyCiphertext NVARCHAR(MAX) NOT NULL,
        OutboundTokenHash NVARCHAR(128) NOT NULL,
        DrvowaIntegrationID NVARCHAR(64) NULL,
        Status NVARCHAR(32) NOT NULL
          CONSTRAINT DF_TblDrvowaIntegrationConfig_Status DEFAULT N'ACTIVE',
        ConnectedAtUtc DATETIME2 NULL,
        UpdatedAtUtc DATETIME2 NOT NULL
          CONSTRAINT DF_TblDrvowaIntegrationConfig_Updated DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_TblDrvowaIntegrationConfig_Singleton CHECK (ConfigID = 1)
      );
    END;
  `);
  console.log('DRVOWA integration schema ready.');
  await closePool();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
  try {
    const { closePool } = await import('../src/lib/db');
    await closePool();
  } catch {
    // ignore shutdown cleanup failure
  }
});
