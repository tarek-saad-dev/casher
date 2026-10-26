#!/usr/bin/env npx tsx
/**
 * Read-only staging preflight: verify exactly one configured primary-sale CashMove writer.
 * This does not perform a paid sale, and is not full POS/Treasury acceptance.
 */
import sql from 'mssql';

const EXPECTED_DB = 'last132_agent';
const EXPECTED_LOGIN = 'drvo_agent';

async function main() {
  const password = process.env.DRVO_STAGING_DB_PASSWORD;
  if (!password) throw new Error('Missing dedicated staging SQL credential');
  if (process.env.DB_DATABASE === 'last132' || process.env.CLOUD_DB_NAME === 'last132') {
    throw new Error('Production database environment detected; refusing');
  }
  const config: sql.config = {
    server: process.env.DRVO_STAGING_DB_SERVER || '127.0.0.1',
    port: Number(process.env.DRVO_STAGING_DB_PORT || '14330'),
    database: EXPECTED_DB,
    user: EXPECTED_LOGIN,
    password,
    options: { encrypt: false, trustServerCertificate: true },
  };
  const pool = await new sql.ConnectionPool(config).connect();
  try {
    const identity = (await pool.request().query(
      'SELECT DB_NAME() AS DatabaseName, SUSER_SNAME() AS LoginName',
    )).recordset[0];
    if (identity?.DatabaseName !== EXPECTED_DB ||
        String(identity?.LoginName).toLowerCase() !== EXPECTED_LOGIN) {
      throw new Error('Staging SQL identity mismatch');
    }
    console.log('PASS: Isolated last132_agent / drvo_agent connection');

    const triggers = await pool.request().query(`
      SELECT t.name, t.is_disabled
      FROM sys.triggers t
      WHERE t.parent_id = OBJECT_ID(N'dbo.TblinvServHead')
        AND t.name = N'InsCashMoveSales'
    `);
    if (triggers.recordset.length !== 1) {
      throw new Error('Cannot verify InsCashMoveSales trigger; do not enable sale posting');
    }
    const enabled = !Boolean(triggers.recordset[0].is_disabled);

    const { isPosSaleTreasuryPostingEnabled } =
      await import('../../src/apps/pos/internal/posSaleTreasuryFlag');
    const extracted = isPosSaleTreasuryPostingEnabled();
    if (extracted && enabled) {
      throw new Error('DUAL_PRIMARY_CASH_WRITERS: extracted Treasury posting and legacy sale trigger both enabled');
    }
    if (!extracted && !enabled) {
      throw new Error('NO_PRIMARY_CASH_WRITER: legacy Treasury mode without sale trigger');
    }
    console.log('PASS: Staging primary CashMove writer configuration coherent: ' +
      (extracted ? 'extracted Treasury adapter' : 'legacy sale trigger'));
    console.log('SALON_POS_TREASURY_WRITER_PREFLIGHT_PASS');
  } finally {
    await pool.close();
  }
}

void main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error('SALON_POS_TREASURY_WRITER_PREFLIGHT_FAIL:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
