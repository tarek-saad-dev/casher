import path from 'path';
import type { ConnectionPool } from 'mssql';
import { checksumFile, legacyCrlfChecksumFile } from '../checksum';
import { executeSqlFile } from '../sqlBatch';
import type { DrvoMigrationDefinition } from '../types';

const SCHEMA = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'db',
  'drvo-migrations',
  '007-booking-hold-key',
  'schema.sql',
);

export const BOOKING_HOLD_KEY_MAX_LEN = 200;

export async function verifyBookingHoldKeyWidth(
  pool: ConnectionPool,
): Promise<{ ok: boolean; failures: string[]; maxLength: number | null }> {
  const table = await pool.request().query(`
    SELECT CASE WHEN OBJECT_ID(N'dbo.TblBookingHold', N'U') IS NULL THEN 0 ELSE 1 END AS ok;
  `);
  if (Number(table.recordset[0]?.ok) !== 1) {
    return { ok: false, failures: ['TblBookingHold missing'], maxLength: null };
  }
  const col = await pool.request().query(`
    SELECT CHARACTER_MAXIMUM_LENGTH AS maxLen
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = N'dbo'
      AND TABLE_NAME = N'TblBookingHold'
      AND COLUMN_NAME = N'HoldKey';
  `);
  const maxLength =
    col.recordset[0]?.maxLen == null ? null : Number(col.recordset[0].maxLen);
  if (maxLength == null || maxLength < BOOKING_HOLD_KEY_MAX_LEN) {
    return {
      ok: false,
      failures: [
        `TblBookingHold.HoldKey length ${maxLength ?? 'null'} < ${BOOKING_HOLD_KEY_MAX_LEN}`,
      ],
      maxLength,
    };
  }
  const uq = await pool.request().query(`
    SELECT CASE WHEN EXISTS (
      SELECT 1
      FROM sys.key_constraints kc
      INNER JOIN sys.index_columns ic
        ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
      INNER JOIN sys.columns c
        ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      WHERE kc.parent_object_id = OBJECT_ID(N'dbo.TblBookingHold')
        AND kc.type = N'UQ'
        AND c.name = N'HoldKey'
    ) THEN 1 ELSE 0 END AS ok;
  `);
  if (Number(uq.recordset[0]?.ok) !== 1) {
    return {
      ok: false,
      failures: ['UQ on TblBookingHold.HoldKey missing after widen'],
      maxLength,
    };
  }
  return { ok: true, failures: [], maxLength };
}

export const bookingHoldKeyMigration: DrvoMigrationDefinition = {
  migrationId: 7,
  migrationKey: 'booking-hold-key',
  name: 'DRVO-004 Booking HoldKey NVARCHAR(200)',
  dependencies: ['booking-prerequisites'],
  checksum: checksumFile(SCHEMA),
  legacyChecksums: [legacyCrlfChecksumFile(SCHEMA)],
  control: {
    kind: 'schema',
    risk: 'HIGH',
    requiresBackup: true,
    lockProfile: 'potentially-blocking',
    rollbackStrategy: 'Restore the approved backup; shrinking HoldKey automatically is not supported.',
  },
  async apply(ctx) {
    await executeSqlFile(ctx.pool, SCHEMA);
  },
  async verify(ctx) {
    const report = await verifyBookingHoldKeyWidth(ctx.pool);
    return { ok: report.ok, failures: report.failures };
  },
  async reconcileBaseline(ctx) {
    const report = await verifyBookingHoldKeyWidth(ctx.pool);
    return report.ok;
  },
};
