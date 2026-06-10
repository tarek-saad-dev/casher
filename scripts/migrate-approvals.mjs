// One-time migration: create TblApprovalRequests
// Run with: node scripts/migrate-approvals.mjs

import sql from 'mssql';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const config = {
  server:   process.env.CLOUD_DB_SERVER   || process.env.DB_SERVER   || '',
  port:     parseInt(process.env.CLOUD_DB_PORT || process.env.DB_PORT || '1433', 10),
  database: process.env.CLOUD_DB_NAME     || process.env.DB_DATABASE || 'HawaiRestaurant',
  user:     process.env.CLOUD_DB_USER     || process.env.DB_USER     || '',
  password: process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD || '',
  options:  { encrypt: true, trustServerCertificate: process.env.CLOUD_DB_TRUST_CERT === 'true', enableArithAbort: true },
  connectionTimeout: 30000, requestTimeout: 30000,
};

async function main() {
  console.log('Connecting...');
  const pool = await new sql.ConnectionPool(config).connect();
  console.log('Connected ✓\n');

  const tableExists = await pool.request().query(`
    SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.TblApprovalRequests') AND type = 'U'
  `);

  if (tableExists.recordset.length > 0) {
    console.log('✅ TblApprovalRequests already exists — skipping creation.');
  } else {
    console.log('▶ Creating TblApprovalRequests...');
    await pool.request().query(`
      CREATE TABLE dbo.TblApprovalRequests (
        ApprovalID           INT IDENTITY(1,1) PRIMARY KEY,
        RequestType          NVARCHAR(100)  NOT NULL,
        EntityType           NVARCHAR(100)  NOT NULL,
        EntityID             NVARCHAR(100)  NULL,
        ActionMethod         NVARCHAR(20)   NOT NULL,
        EndpointPath         NVARCHAR(300)  NULL,
        RequestedByUserID    INT            NOT NULL,
        Status               NVARCHAR(30)   NOT NULL DEFAULT 'pending',
        OldData              NVARCHAR(MAX)  NULL,
        NewData              NVARCHAR(MAX)  NULL,
        Reason               NVARCHAR(500)  NULL,
        RiskLevel            NVARCHAR(30)   NOT NULL DEFAULT 'medium',
        ReviewedByUserID     INT            NULL,
        ReviewedAt           DATETIME2      NULL,
        ReviewNote           NVARCHAR(500)  NULL,
        ExecutedAt           DATETIME2      NULL,
        ErrorMessage         NVARCHAR(MAX)  NULL,
        CreatedAt            DATETIME2      NOT NULL DEFAULT GETDATE(),
        CONSTRAINT FK_ApprovalReq_RequestedBy FOREIGN KEY (RequestedByUserID) REFERENCES dbo.TblUser(UserID),
        CONSTRAINT FK_ApprovalReq_ReviewedBy  FOREIGN KEY (ReviewedByUserID)  REFERENCES dbo.TblUser(UserID)
      );
    `);
    console.log('  ✓ Table created.');

    await pool.request().query(`CREATE INDEX IX_ApprovalReq_Status      ON dbo.TblApprovalRequests (Status);`);
    await pool.request().query(`CREATE INDEX IX_ApprovalReq_RequestedBy ON dbo.TblApprovalRequests (RequestedByUserID);`);
    await pool.request().query(`CREATE INDEX IX_ApprovalReq_RequestType ON dbo.TblApprovalRequests (RequestType);`);
    await pool.request().query(`CREATE INDEX IX_ApprovalReq_CreatedAt   ON dbo.TblApprovalRequests (CreatedAt DESC);`);
    console.log('  ✓ Indexes created.');
  }

  console.log('\n✅ Migration complete!');
  await pool.close();
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
