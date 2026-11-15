/**
 * SQL Server transport for CUT CLUB staging-only OTP storage contract (#295).
 *
 * No pool created, no env read and no network connection upon import.
 * A future operator must explicitly construct this from a trusted, dedicated
 * staging ConnectionPool. The repository repeats DB_NAME/SUSER_SNAME inside
 * EVERY transaction and remains disabled by default.
 */
import sql from "mssql";
import type { CutClubSqlTransaction, CutClubStagingSqlPort, SqlField, SqlFieldKind } from "./sqlOtpRepository";

function kind(type: SqlFieldKind): sql.ISqlType {
  switch (type) {
    case "uuid": return sql.UniqueIdentifier;
    case "bytes32": return sql.Binary(32);
    case "varchar32": return sql.VarChar(32);
    case "varchar64": return sql.VarChar(64);
    case "nvarchar20": return sql.NVarChar(20);
    case "nvarchar8": return sql.NVarChar(8);
    case "int": return sql.Int;
    case "bigint": return sql.BigInt;
  }
}

function bind(request: sql.Request, field: SqlField): void {
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,50}$/.test(field.name)) throw new Error("INVALID_SQL_BINDING");
  if (field.kind === "bytes32" && (!Buffer.isBuffer(field.value) || field.value.byteLength !== 32)) {
    throw new Error("INVALID_SQL_BINARY");
  }
  request.input(field.name, kind(field.kind), field.value);
}

/** Do not construct this port in customer-facing routes before staged signoff. */
export function createCutClubMssqlStagingPort(pool: sql.ConnectionPool): CutClubStagingSqlPort {
  return {
    async transaction<T>(work: (tx: CutClubSqlTransaction) => Promise<T>): Promise<T> {
      const transaction = new sql.Transaction(pool);
      await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      let committed = false;
      try {
        const adapter: CutClubSqlTransaction = {
          async execute(query, fields: readonly SqlField[] = []) {
            const request = new sql.Request(transaction);
            for (const field of fields) bind(request, field);
            const result = await request.query(query);
            return {
              rows: (result.recordset ?? []) as Record<string, unknown>[],
              affected: result.rowsAffected?.[0] ?? 0,
            };
          },
        };
        const result = await work(adapter);
        await transaction.commit();
        committed = true;
        return result;
      } catch (error) {
        if (!committed) {
          try { await transaction.rollback(); } catch { /* original error wins */ }
        }
        throw error;
      }
    },
  };
}
