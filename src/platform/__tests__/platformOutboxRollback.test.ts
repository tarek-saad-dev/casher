import { describe, expect, it } from 'vitest';
import sql from 'mssql';
import {
  countOutboxRowsForTenant,
  publishPlatformOutboxEvent,
} from '@/platform/outbox/publisher';

const PRODUCTION_DB = 'last132';
const STAGING_DB = 'last132_agent';

function configuredDatabase(): string {
  return process.env.CLOUD_DB_NAME || process.env.DB_DATABASE || '';
}

function stagingPoolConfig(): sql.config | null {
  const database = configuredDatabase();
  const server = process.env.CLOUD_DB_SERVER || process.env.DB_SERVER || '';
  const user = process.env.CLOUD_DB_USER || process.env.DB_USER || '';
  const password = process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD || '';
  if (!server || !user || !password || database !== STAGING_DB) return null;
  return {
    server,
    port: parseInt(process.env.CLOUD_DB_PORT || process.env.DB_PORT || '1433', 10),
    database,
    user,
    password,
    options: {
      encrypt: process.env.CLOUD_DB_ENCRYPT !== 'false' && process.env.DB_ENCRYPT !== 'false',
      trustServerCertificate:
        process.env.CLOUD_DB_TRUST_CERT === 'true' ||
        process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
      enableArithAbort: true,
    },
    requestTimeout: 120000,
  };
}

describe('PlatformOutbox transaction rollback', () => {
  it('does not target production database last132', () => {
    expect(configuredDatabase()).not.toBe(PRODUCTION_DB);
  });

  it('inserts through publishPlatformOutboxEvent and drops the row on caller rollback', async () => {
    const dbSql = await import('@/lib/db');
    const originalRequest = dbSql.sql.Request;
    const rowsByTx = new WeakMap<object, Array<Record<string, unknown>>>();

    class RecordingRequest {
      private inputs: Record<string, unknown> = {};

      constructor(private tx: object) {}

      input(name: string, _type: unknown, value: unknown) {
        this.inputs[name] = value;
        return this;
      }

      async query(text: string) {
        const rows = rowsByTx.get(this.tx) ?? [];
        rowsByTx.set(this.tx, rows);
        if (text.includes('INSERT INTO dbo.PlatformOutbox')) {
          rows.push({ ...this.inputs });
          return { recordset: [{ id: rows.length }] };
        }
        if (text.includes('COUNT(*)')) {
          const tenantId = this.inputs.tenantId;
          return {
            recordset: [{ cnt: rows.filter((row) => row.tenantId === tenantId).length }],
          };
        }
        throw new Error(`unexpected query: ${text}`);
      }
    }

    (dbSql.sql as { Request: unknown }).Request = RecordingRequest;
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const tx = {
      async rollback() {
        rowsByTx.set(tx, []);
      },
    };

    try {
      const id = await publishPlatformOutboxEvent(tx as unknown as sql.Transaction, {
        tenantId,
        aggregateType: 'test',
        aggregateId: 'rollback-proof',
        eventType: 'test.rollback',
        payload: '{}',
        idempotencyKey: 'unit-rollback',
      });
      expect(id).toBe(1);
      expect(await countOutboxRowsForTenant(tx as unknown as sql.Transaction, tenantId)).toBe(1);
      await tx.rollback();
      expect(await countOutboxRowsForTenant(tx as unknown as sql.Transaction, tenantId)).toBe(0);
    } finally {
      (dbSql.sql as { Request: unknown }).Request = originalRequest;
    }
  });

  it.skipIf(!stagingPoolConfig())(
    'rolls back the outbox insert and its tenant row on last132_agent',
    async () => {
      const config = stagingPoolConfig();
      if (!config) throw new Error('staging config missing');
      if (config.database === PRODUCTION_DB) {
        throw new Error(`Refusing production database ${PRODUCTION_DB}`);
      }

      const pool = await new sql.ConnectionPool(config).connect();
      const tenantId = crypto.randomUUID();
      const code = `RB${tenantId.replace(/-/g, '')}`.slice(0, 64);
      try {
        const dbName = await pool.request().query(`SELECT DB_NAME() AS name;`);
        const name = String(dbName.recordset[0].name);
        if (name !== STAGING_DB) {
          throw new Error(`Refusing database ${name}`);
        }

        const before = await pool
          .request()
          .input('tenantId', sql.UniqueIdentifier, tenantId)
          .query(
            `SELECT COUNT(*) AS cnt FROM dbo.PlatformOutbox WHERE TenantId = @tenantId;`,
          );
        expect(Number(before.recordset[0].cnt)).toBe(0);

        const tx = new sql.Transaction(pool);
        await tx.begin();
        try {
          await new sql.Request(tx)
            .input('tenantId', sql.UniqueIdentifier, tenantId)
            .input('code', sql.NVarChar(64), code)
            .query(`
              INSERT INTO dbo.Tenant (TenantId, Code, Name, Status, DefaultTimezone)
              VALUES (@tenantId, @code, N'outbox rollback probe', N'active', N'Africa/Cairo');
            `);
          await publishPlatformOutboxEvent(tx, {
            tenantId,
            aggregateType: 'test',
            aggregateId: 'rollback-proof',
            eventType: 'test.rollback',
            payload: '{}',
            idempotencyKey: `test-rollback-${tenantId}`,
          });
          const inTx = await countOutboxRowsForTenant(tx, tenantId);
          expect(inTx).toBe(1);
          await tx.rollback();
        } catch (err) {
          try {
            await tx.rollback();
          } catch {
            /* already rolled back */
          }
          throw err;
        }

        const after = await pool
          .request()
          .input('tenantId', sql.UniqueIdentifier, tenantId)
          .query(
            `SELECT COUNT(*) AS cnt FROM dbo.PlatformOutbox WHERE TenantId = @tenantId;`,
          );
        expect(Number(after.recordset[0].cnt)).toBe(0);
        const tenantAfter = await pool
          .request()
          .input('tenantId', sql.UniqueIdentifier, tenantId)
          .query(`SELECT COUNT(*) AS cnt FROM dbo.Tenant WHERE TenantId = @tenantId;`);
        expect(Number(tenantAfter.recordset[0].cnt)).toBe(0);
      } finally {
        await pool.close();
      }
    },
  );
});
