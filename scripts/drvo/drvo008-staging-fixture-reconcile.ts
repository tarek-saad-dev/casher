#!/usr/bin/env npx tsx
/**
 * DRVO-008 synthetic customer/invoice reconciliation.
 * Staging database last132_agent / drvo_agent ONLY. No production credentials,
 * customers, branches, money, unmarked invoices or schema changes.
 *
 * Default: read-only audit and fail if prior failed-run fixtures remain.
 * --apply-staging-fixture-recovery: release-gate scoped cleanup of ONLY
 * DRVO008-SMOKE customers (both Name AND Notes) and invoices whose Notes2
 * is exactly one of the two DRVO-008 synthetic test markers.
 */
import path from 'node:path';
import Module from 'node:module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });
const moduleLoader = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const defaultLoad = moduleLoader._load;
moduleLoader._load = function noServerOnly(request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return defaultLoad.call(moduleLoader, request, ...rest);
};

const DB = 'last132_agent';
const LOGIN = 'drvo_agent';
const SYNTHETIC = 'DRVO008-SMOKE';
const EXTRACTED = 'drvo-008-pos-staging-smoke';
const LEGACY = 'drvo-008-legacy-staging-smoke';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('DRVO008 STAGING FIXTURE RECONCILIATION NO-GO: ' + message);
}
type Invoice = {
  invID: number;
  BranchID: number;
  UserID: number;
  Notes2: string | null;
};
type StagingCustomer = { ClientID: number; TenantId: string };

async function main() {
  const doApply = process.argv.includes('--apply-staging-fixture-recovery');
  const password = process.env.DRVO_STAGING_DB_PASSWORD;
  assert(password, 'protected staging SQL secret missing');
  assert(process.env.DB_DATABASE !== 'last132' &&
         process.env.CLOUD_DB_NAME !== 'last132',
    'production environment refused');
  Object.assign(process.env, {
    DB_SERVER: '127.0.0.1', DB_PORT: '14330', DB_DATABASE: DB,
    DB_USER: LOGIN, DB_PASSWORD: password,
    DB_ENCRYPT: 'false', DB_TRUST_SERVER_CERTIFICATE: 'true',
    CLOUD_DB_SERVER: '127.0.0.1', CLOUD_DB_PORT: '14330', CLOUD_DB_NAME: DB,
    CLOUD_DB_USER: LOGIN, CLOUD_DB_PASSWORD: password,
    CLOUD_DB_ENCRYPT: 'false', CLOUD_DB_TRUST_CERT: 'true',
    WHATSAPP_INTEGRATION_ENABLED: 'false', WHATSAPP_SALE_ENABLED: 'false',
    WHATSAPP_EMPLOYEE_SALE_ENABLED: 'false',
  });

  const { getPool, closePool, sql } = await import('../src/lib/db');
  const legacy = await import('../src/lib/actions/invoiceActions');
  const { deleteSale } = await import('../src/apps/pos/public');
  const pool = await getPool();
  try {
    const connection = await pool.request().query(
      'SELECT DB_NAME() AS Db, SUSER_SNAME() AS LoginName;',
    );
    assert(connection.recordset.length === 1 &&
       connection.recordset[0].Db === DB &&
       String(connection.recordset[0].LoginName).toLowerCase() === LOGIN,
      'database identity changed or permission mismatch');

    const candidates = await pool.request().query(`
      SELECT c.ClientID,c.TenantId
      FROM dbo.TblClient c WITH (READCOMMITTEDLOCK)
      WHERE c.Name=N'${SYNTHETIC}' AND c.Notes=N'${SYNTHETIC}'
      ORDER BY c.ClientID;
    `);
    assert(candidates.recordset.length <= 20,
      'more than 20 synthetic clients; manual staging review required');
    console.log('DRVO008 STAGING ORPHAN AUDIT:', {
      count: candidates.recordset.length,
      clientIds: candidates.recordset.map((x: StagingCustomer) => Number(x.ClientID)),
      mode: doApply ? 'guarded cleanup' : 'read-only',
    });
    if (!doApply) {
      assert(candidates.recordset.length === 0,
        'synthetic clients/invoices remain after the DRVO-008 smoke');
      console.log('DRVO008 STAGING ORPHAN AUDIT PASS');
      return;
    }

    for (const client of candidates.recordset as StagingCustomer[]) {
      const clientId = Number(client.ClientID);
      const tenantId = String(client.TenantId);
      assert(Number.isSafeInteger(clientId) && clientId > 0 &&
        /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(tenantId),
      'synthetic customer has invalid identity');

      const ownedSales = await pool.request()
        .input('clientId', sql.Int, clientId)
        .query(`
          SELECT invID,BranchID,UserID,Notes2 FROM dbo.TblinvServHead
          WHERE ClientID=@clientId AND invType=N'مبيعات';
        `);
      assert(ownedSales.recordset.length <= 1,
        'synthetic client has more than one paid invoice; manual review required');
      for (const invoice of ownedSales.recordset as Invoice[]) {
        const invId = Number(invoice.invID);
        const branchId = Number(invoice.BranchID);
        const userId = Number(invoice.UserID);
        const marker = String(invoice.Notes2 ?? '');
        assert(marker === EXTRACTED || marker === LEGACY,
          'invoice marker is not the explicitly allowed staging test marker');
        assert([invId, branchId, userId].every(
          value => Number.isSafeInteger(value) && value > 0),
        'invalid invoice provenance');

        let tx: InstanceType<typeof sql.Transaction> | null = new sql.Transaction(pool);
        await tx.begin();
        try {
          const verified = await new sql.Request(tx)
            .input('invID', sql.Int, invId)
            .input('clientId', sql.Int, clientId)
            .input('branchId', sql.Int, branchId)
            .input('userId', sql.Int, userId)
            .input('tenant', sql.UniqueIdentifier, tenantId)
            .input('marker', sql.NVarChar(100), marker)
            .query(`
              SELECT h.invID
              FROM dbo.TblinvServHead h WITH (UPDLOCK, HOLDLOCK)
              JOIN dbo.TblClient c ON c.ClientID=h.ClientID AND c.TenantId=@tenant
              JOIN dbo.Location l ON l.LegacyBranchId=h.BranchID AND l.TenantId=@tenant
              JOIN dbo.TenantMembership m ON m.TenantId=@tenant AND m.LegacyUserId=h.UserID
              WHERE h.invID=@invID AND h.invType=N'مبيعات'
                AND h.ClientID=@clientId AND h.BranchID=@branchId AND h.UserID=@userId
                AND c.Name=N'${SYNTHETIC}' AND c.Notes=N'${SYNTHETIC}'
                AND h.Notes2=@marker;
            `);
          assert(verified.recordset.length === 1,
            'refusing to delete invoice without complete synthetic tenant/shift/staff ownership');
          if (marker === LEGACY) {
            await legacy.deleteInvoice(tx, invId, branchId);
          } else {
            await deleteSale(tx, invId, branchId, userId);
          }
          await tx.commit();
          tx = null;
        } catch (err) {
          if (tx) {
            try { await tx.rollback(); } catch { /* already closed */ }
          }
          throw err;
        }

        const after = await pool.request().input('invoiceId', sql.Int, invId)
          .query(`
            SELECT (SELECT COUNT(*) FROM dbo.TblinvServHead
                     WHERE invID=@invoiceId AND invType=N'مبيعات') AS Headers,
                   (SELECT COUNT(*) FROM dbo.TblinvServPayment
                     WHERE invID=@invoiceId AND invType=N'مبيعات') AS Payments,
                   (SELECT COUNT(*) FROM dbo.TblCashMove
                     WHERE invID=@invoiceId AND invType=N'مبيعات') AS Cash;
          `);
        const remaining = after.recordset[0];
        assert(Number(remaining.Headers) === 0 &&
               Number(remaining.Payments) === 0 &&
               Number(remaining.Cash) === 0,
          'financial residues after synthetic invoice deletion: ' + JSON.stringify(remaining));
        console.log('DRVO008 STAGING: safely reversed synthetic invoice', invId);
      }

      const stillHasInvoice = await pool.request().input('clientId', sql.Int, clientId)
        .query('SELECT COUNT(*) AS cnt FROM dbo.TblinvServHead WHERE ClientID=@clientId');
      assert(Number(stillHasInvoice.recordset[0]?.cnt) === 0,
        'refusing client cleanup while invoice remains');

      // Customer removal is allowed only after ownership of exactly this
      // synthetic client has been proven. Keep every real customer untouched.
      const deletion = await pool.request()
        .input('clientId', sql.Int, clientId)
        .input('tenant', sql.UniqueIdentifier, tenantId)
        .query(`
          IF EXISTS (SELECT 1 FROM dbo.TblClient
               WHERE ClientID=@clientId AND TenantId=@tenant
                 AND Name=N'${SYNTHETIC}' AND Notes=N'${SYNTHETIC}')
          BEGIN
            DELETE FROM dbo.TblClientLoyalty WHERE ClientID=@clientId;
            DELETE FROM dbo.TblLoyaltyPointLedger WHERE ClientID=@clientId;
            DELETE FROM dbo.TblClient
            WHERE ClientID=@clientId AND TenantId=@tenant
              AND Name=N'${SYNTHETIC}' AND Notes=N'${SYNTHETIC}';
          END
        `);
      assert(deletion.rowsAffected.some(v => v > 0),
        'synthetic client delete had zero affected rows');
      const remains = await pool.request()
        .input('clientId', sql.Int, clientId)
        .query('SELECT COUNT(*) AS cnt FROM dbo.TblClient WHERE ClientID=@clientId;');
      assert(Number(remains.recordset[0]?.cnt) === 0,
        'synthetic client cleanup verification failed');
      console.log('DRVO008 STAGING: safely removed synthetic client', clientId);
    }

    const check = await pool.request().query(`
      SELECT COUNT(*) AS CountRemaining FROM dbo.TblClient
      WHERE Name=N'${SYNTHETIC}' AND Notes=N'${SYNTHETIC}';
    `);
    assert(Number(check.recordset[0]?.CountRemaining) === 0,
      'not all proven synthetic fixtures could be reconciled');
    console.log('DRVO008 STAGING FIXTURE RECONCILIATION PASS');
  } finally {
    await closePool();
  }
}

void main().then(() => process.exit(0)).catch(err => {
  console.error('DRVO008 STAGING RECONCILIATION FAILED:', err);
  process.exit(1);
});
