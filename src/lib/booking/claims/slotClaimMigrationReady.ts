/**
 * B6.5 — migration readiness (read-only verify). Never CREATE from request paths.
 */

import { getPool } from '@/lib/db';

export type SlotClaimMigrationReadiness = {
  ready: boolean;
  tableExists: boolean;
  uniqueEmpSlot: boolean;
  indexHoldToken: boolean;
  indexBookingId: boolean;
  indexEmpTypeExpires: boolean;
  indexExpiresHold: boolean;
  indexes: Array<{
    name: string;
    isUnique: boolean;
    cols: string;
    filter: string | null;
  }>;
  missing: string[];
};

export async function verifySlotClaimMigrationReadiness(): Promise<SlotClaimMigrationReadiness> {
  const db = await getPool();
  const table = await db.request().query(`
    SELECT OBJECT_ID(N'dbo.TblBookingSlotClaim', N'U') AS TableId
  `);
  const tableExists = table.recordset[0]?.TableId != null;
  if (!tableExists) {
    return {
      ready: false,
      tableExists: false,
      uniqueEmpSlot: false,
      indexHoldToken: false,
      indexBookingId: false,
      indexEmpTypeExpires: false,
      indexExpiresHold: false,
      indexes: [],
      missing: [
        'TblBookingSlotClaim',
        'UQ_TblBookingSlotClaim_Emp_Slot',
        'IX_SlotClaim_HoldToken',
        'IX_SlotClaim_BookingID',
        'IX_SlotClaim_Emp_Type_Expires',
        'IX_SlotClaim_Expires_Hold',
      ],
    };
  }

  const indexes = await db.request().query(`
    SELECT
      i.name AS IndexName,
      CAST(i.is_unique AS int) AS IsUnique,
      i.filter_definition AS FilterDefinition,
      STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) AS Cols
    FROM sys.indexes i
    JOIN sys.index_columns ic
      ON i.object_id = ic.object_id AND i.index_id = ic.index_id
    JOIN sys.columns c
      ON ic.object_id = c.object_id AND ic.column_id = c.column_id
    WHERE i.object_id = OBJECT_ID(N'dbo.TblBookingSlotClaim')
      AND i.name IS NOT NULL
    GROUP BY i.name, i.is_unique, i.filter_definition
  `);

  const list = (indexes.recordset as Record<string, unknown>[]).map((r) => ({
    name: String(r.IndexName),
    isUnique: Number(r.IsUnique) === 1,
    cols: String(r.Cols ?? ''),
    filter: r.FilterDefinition != null ? String(r.FilterDefinition) : null,
  }));

  const byName = new Map(list.map((i) => [i.name, i]));
  const uniqueEmpSlot =
    byName.get('UQ_TblBookingSlotClaim_Emp_Slot')?.isUnique === true &&
    /EmpID/i.test(byName.get('UQ_TblBookingSlotClaim_Emp_Slot')!.cols) &&
    /AbsoluteSlotStartUtc/i.test(byName.get('UQ_TblBookingSlotClaim_Emp_Slot')!.cols);
  const indexHoldToken = byName.has('IX_SlotClaim_HoldToken');
  const indexBookingId = byName.has('IX_SlotClaim_BookingID');
  const indexEmpTypeExpires = byName.has('IX_SlotClaim_Emp_Type_Expires');
  const indexExpiresHold = byName.has('IX_SlotClaim_Expires_Hold');

  const missing: string[] = [];
  if (!uniqueEmpSlot) missing.push('UQ_TblBookingSlotClaim_Emp_Slot');
  if (!indexHoldToken) missing.push('IX_SlotClaim_HoldToken');
  if (!indexBookingId) missing.push('IX_SlotClaim_BookingID');
  if (!indexEmpTypeExpires) missing.push('IX_SlotClaim_Emp_Type_Expires');
  if (!indexExpiresHold) missing.push('IX_SlotClaim_Expires_Hold');

  return {
    ready: missing.length === 0,
    tableExists: true,
    uniqueEmpSlot,
    indexHoldToken,
    indexBookingId,
    indexEmpTypeExpires,
    indexExpiresHold,
    indexes: list,
    missing,
  };
}
