/**
 * Booking V2 B9.5 — SQL-backed public bootstrap snapshot (cross-instance / serverless).
 * Deploy-time table. Not SoT — catalog rebuild fills it. Revision-driven invalidation.
 */

import { getPool, sql } from '@/lib/db';

export type BootstrapSqlSnapshot = {
  revision: string;
  payloadJson: string;
  builtAtMs: number;
};

let tableMissing = false;

export type BootstrapSqlStore = {
  load(scopeKey: string): Promise<BootstrapSqlSnapshot | null>;
  save(args: {
    scopeKey: string;
    revision: string;
    payloadJson: string;
  }): Promise<void>;
  invalidate(scopeKey?: string): Promise<void>;
};

export function createBootstrapSqlStore(): BootstrapSqlStore {
  return {
    async load(scopeKey) {
      if (tableMissing) return null;
      try {
        const db = await getPool();
        const res = await db
          .request()
          .input('scope', sql.NVarChar(80), scopeKey)
          .query(`
            SELECT TOP 1 Revision, PayloadJson,
                   DATEDIFF_BIG(ms, '1970-01-01', BuiltAtUtc) AS BuiltAtMs
            FROM dbo.TblBookingBootstrapSnapshot
            WHERE ScopeKey = @scope
          `);
        const row = res.recordset[0] as
          | { Revision: string; PayloadJson: string; BuiltAtMs: number }
          | undefined;
        if (!row) return null;
        return {
          revision: String(row.Revision),
          payloadJson: String(row.PayloadJson),
          builtAtMs: Number(row.BuiltAtMs) || Date.now(),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/TblBookingBootstrapSnapshot|Invalid object name/i.test(msg)) {
          tableMissing = true;
        }
        return null;
      }
    },

    async save(args) {
      if (tableMissing) return;
      try {
        const db = await getPool();
        await db
          .request()
          .input('scope', sql.NVarChar(80), args.scopeKey)
          .input('rev', sql.NVarChar(40), args.revision)
          .input('payload', sql.NVarChar(sql.MAX), args.payloadJson)
          .query(`
            MERGE dbo.TblBookingBootstrapSnapshot AS t
            USING (SELECT @scope AS ScopeKey) AS s
            ON t.ScopeKey = s.ScopeKey
            WHEN MATCHED THEN
              UPDATE SET Revision = @rev, PayloadJson = @payload,
                         BuiltAtUtc = SYSUTCDATETIME()
            WHEN NOT MATCHED THEN
              INSERT (ScopeKey, Revision, PayloadJson)
              VALUES (@scope, @rev, @payload);
          `);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/TblBookingBootstrapSnapshot|Invalid object name/i.test(msg)) {
          tableMissing = true;
        }
      }
    },

    async invalidate(scopeKey) {
      if (tableMissing) return;
      try {
        const db = await getPool();
        if (scopeKey) {
          await db
            .request()
            .input('scope', sql.NVarChar(80), scopeKey)
            .query(`DELETE FROM dbo.TblBookingBootstrapSnapshot WHERE ScopeKey = @scope`);
        } else {
          await db.request().query(`DELETE FROM dbo.TblBookingBootstrapSnapshot`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/TblBookingBootstrapSnapshot|Invalid object name/i.test(msg)) {
          tableMissing = true;
        }
      }
    },
  };
}

let singleton: BootstrapSqlStore | null = null;

export function getBootstrapSqlStore(): BootstrapSqlStore {
  if (!singleton) singleton = createBootstrapSqlStore();
  return singleton;
}

export function __resetBootstrapSqlStoreForTests(): void {
  singleton = null;
  tableMissing = false;
}
