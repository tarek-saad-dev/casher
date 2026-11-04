import path from 'path';
import type { ConnectionPool } from 'mssql';
import { checksumFile } from '../checksum';
import { executeSqlFile } from '../sqlBatch';
import type { DrvoMigrationDefinition } from '../types';

const SCHEMA = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'db',
  'drvo-migrations',
  '020-booking-cashier-handoff',
  'schema.sql',
);

export async function verifyBookingCashierHandoffSchema(
  pool: ConnectionPool,
): Promise<{ ok: boolean; failures: string[] }> {
  const failures: string[] = [];
  const exists = await pool.request().query(
    "SELECT CASE WHEN OBJECT_ID(N'dbo.TblBookingCashierHandoff', N'U') IS NULL THEN 0 ELSE 1 END AS ok;",
  );
  if (Number(exists.recordset[0]?.ok) !== 1) {
    return { ok: false, failures: ['Missing TblBookingCashierHandoff'] };
  }
  for (const col of [
    'HandoffID',
    'BookingID',
    'BranchID',
    'EmpID',
    'TenantId',
    'Status',
    'PayloadJson',
    'LockedByUserID',
    'LockedAt',
    'ChargedInvID',
    'ChargedAt',
    'CreatedAt',
    'UpdatedAt',
  ]) {
    const r = await pool
      .request()
      .input('col', col)
      .query(
        "SELECT CASE WHEN COL_LENGTH(N'dbo.TblBookingCashierHandoff', @col) IS NULL THEN 0 ELSE 1 END AS ok;",
      );
    if (Number(r.recordset[0]?.ok) !== 1) failures.push(`Missing column ${col}`);
  }
  for (const name of [
    'UX_TblBookingCashierHandoff_ActiveBooking',
    'IX_TblBookingCashierHandoff_BranchInbox',
    'IX_TblBookingCashierHandoff_TenantEmp',
  ]) {
    const r = await pool
      .request()
      .input('name', name)
      .query(
        `SELECT CASE WHEN EXISTS(
          SELECT 1 FROM sys.indexes
          WHERE object_id = OBJECT_ID(N'dbo.TblBookingCashierHandoff')
            AND name = @name AND is_disabled = 0
        ) THEN 1 ELSE 0 END AS ok;`,
      );
    if (Number(r.recordset[0]?.ok) !== 1) failures.push(`Missing index ${name}`);
  }
  for (const name of [
    'CK_TblBookingCashierHandoff_Status',
    'CK_TblBookingCashierHandoff_PayloadJson',
    'CK_TblBookingCashierHandoff_Charged',
  ]) {
    const r = await pool
      .request()
      .input('name', name)
      .query(
        `SELECT CASE WHEN EXISTS(
          SELECT 1 FROM sys.check_constraints
          WHERE parent_object_id = OBJECT_ID(N'dbo.TblBookingCashierHandoff')
            AND name = @name AND is_disabled = 0 AND is_not_trusted = 0
        ) THEN 1 ELSE 0 END AS ok;`,
      );
    if (Number(r.recordset[0]?.ok) !== 1) failures.push(`Missing/untrusted CHECK ${name}`);
  }
  return { ok: failures.length === 0, failures };
}

export const bookingCashierHandoffMigration: DrvoMigrationDefinition = {
  migrationId: 20,
  migrationKey: 'booking-cashier-handoff',
  name: 'Optional barber-to-cashier booking handoff for POS settlement',
  dependencies: ['tariff-research-review'],
  checksum: checksumFile(SCHEMA),
  control: {
    kind: 'schema',
    risk: 'LOW',
    requiresBackup: false,
    lockProfile: 'short',
    rollbackStrategy:
      'Additive handoff table only. Disable portal/POS handoff UI; retain rows for audit.',
  },
  async apply(ctx) {
    await executeSqlFile(ctx.pool, SCHEMA);
  },
  async verify(ctx) {
    return verifyBookingCashierHandoffSchema(ctx.pool);
  },
  async reconcileBaseline(ctx) {
    return (await verifyBookingCashierHandoffSchema(ctx.pool)).ok;
  },
};
