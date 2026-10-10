#!/usr/bin/env npx tsx
/**
 * Staging check for db/migrations/allow-null-purchase-client-id.sql (last132_agent / drvo_agent only).
 * Every probe row is written inside one transaction that is always rolled back.
 */
import sql from 'mssql';

const STAGING_DB = 'last132_agent';
const STAGING_LOGIN = 'drvo_agent';

function check(ok: boolean, label: string): void {
  if (!ok) throw new Error(label);
  console.log(`  ok: ${label}`);
}

async function main(): Promise<void> {
  const password = process.env.DRVO_STAGING_DB_PASSWORD;
  if (!password) throw new Error('Missing DRVO_STAGING_DB_PASSWORD (staging only; .env.local is never read).');
  const pool = await sql.connect({
    server: process.env.DRVO_STAGING_DB_SERVER || '127.0.0.1',
    port: Number(process.env.DRVO_STAGING_DB_PORT || 14330),
    database: STAGING_DB,
    user: STAGING_LOGIN,
    password,
    options: { encrypt: false, trustServerCertificate: true },
  });
  try {
    const id = (await pool.request().query(`SELECT DB_NAME() AS db, SUSER_SNAME() AS login, HAS_DBACCESS('last132') AS p;`)).recordset[0];
    if (id.db !== STAGING_DB || id.login !== STAGING_LOGIN || id.p !== 0) throw new Error(`IDENTITY_FAIL ${JSON.stringify(id)}`);
    console.log(`identity: ${id.db} / ${id.login} / last132 access=${id.p}`);

    const schema = (await pool.request().query(`
      SELECT c.is_nullable AS nullable, fk.name AS fkName, fk.is_not_trusted AS notTrusted, fk.is_disabled AS disabled,
             OBJECT_NAME(fk.referenced_object_id) AS refTable, fk.delete_referential_action_desc AS onDelete
      FROM sys.columns c
      LEFT JOIN sys.foreign_key_columns fkc ON fkc.parent_object_id = c.object_id AND fkc.parent_column_id = c.column_id
      LEFT JOIN sys.foreign_keys fk ON fk.object_id = fkc.constraint_object_id
      WHERE c.object_id = OBJECT_ID(N'dbo.TblinvPurchaseHead') AND c.name = N'ClientID';`)).recordset[0];
    console.log(`schema: ${JSON.stringify(schema)}`);
    check(schema.nullable === true, 'ClientID allows NULL');
    check(schema.fkName === 'FK_TblinvPurchaseHead_TblClient' && schema.refTable === 'TblClient', 'FK_TblinvPurchaseHead_TblClient → TblClient preserved');
    check(schema.notTrusted === false && schema.disabled === false, 'FK is enabled and trusted (existing rows validated)');

    const ref = (await pool.request().query(`
      SELECT (SELECT TOP 1 ClientID FROM dbo.TblClient ORDER BY ClientID) AS clientId,
             (SELECT ISNULL(MAX(ClientID), 0) + 1000000 FROM dbo.TblClient) AS badClientId,
             (SELECT TOP 1 BranchID FROM dbo.TblBranch ORDER BY BranchID) AS branchId,
             (SELECT ISNULL(MAX(invID), 0) + 900000 FROM dbo.TblinvPurchaseHead) AS invId;`)).recordset[0];

    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const insert = (invId: number, clientId: number | null) =>
        new sql.Request(tx)
          .input('invID', sql.Int, invId)
          .input('ClientID', sql.Int, clientId)
          .input('BranchID', sql.Int, ref.branchId)
          .query(`
            INSERT INTO dbo.TblinvPurchaseHead (invID, invType, invDate, ClientID, BranchID, PostStatus, Notes)
            VALUES (@invID, N'مشتريات', CAST(GETDATE() AS date), @ClientID, @BranchID, N'DRAFT', N'legacy-client-id-verify');`);

      await insert(ref.invId, null);
      check(true, 'insert with ClientID = NULL accepted');

      await insert(ref.invId + 1, Number(ref.clientId));
      const kept = (await new sql.Request(tx).input('invID', sql.Int, ref.invId + 1)
        .query(`SELECT ClientID FROM dbo.TblinvPurchaseHead WHERE invID = @invID AND invType = N'مشتريات';`)).recordset[0];
      check(Number(kept?.ClientID) === Number(ref.clientId), 'non-null valid ClientID still accepted and stored');

      let rejected = '';
      await new sql.Request(tx).query('SAVE TRANSACTION before_bad_client;');
      try {
        await insert(ref.invId + 2, Number(ref.badClientId));
      } catch (err) {
        rejected = err instanceof Error ? err.message : String(err);
      }
      check(/FOREIGN KEY|FK_TblinvPurchaseHead_TblClient/i.test(rejected), 'invalid non-null ClientID rejected by the FK');
    } finally {
      await tx.rollback().catch(() => undefined);
    }
    const left = (await pool.request().query(`SELECT COUNT(*) AS n FROM dbo.TblinvPurchaseHead WHERE Notes = N'legacy-client-id-verify';`)).recordset[0].n;
    check(left === 0, 'probe rows rolled back');
    console.log('legacy purchase ClientID verify PASS');
  } finally {
    await pool.close();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('legacy purchase ClientID verify FAIL:', err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
