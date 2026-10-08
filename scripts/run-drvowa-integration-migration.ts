#!/usr/bin/env npx tsx
import path from 'path';
import dotenv from 'dotenv';
import { getLocalPool, closePool } from '../src/lib/db';

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

async function main() {
  const pool = await getLocalPool();
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
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => {});
  });
