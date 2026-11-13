import 'server-only';
import { getPool, sql } from '@/lib/db';
import { toolErr, toolOk } from '../result';
import type { DrvowaToolResult } from '../types';
import {
  clampPageLimit,
  DrvowaValidationError,
  parseOptionalNonNegativeInt,
} from '../validate';

const TOOL = 'customer.list_changes';

let tblClientHasEmailColumn: boolean | null = null;

async function hasEmailColumn(
  db: Awaited<ReturnType<typeof getPool>>,
): Promise<boolean> {
  if (tblClientHasEmailColumn !== null) return tblClientHasEmailColumn;
  const result = await db.request().query(`
    SELECT COL_LENGTH(N'dbo.TblClient', N'Email') AS Len
  `);
  tblClientHasEmailColumn = Number(result.recordset[0]?.Len ?? 0) > 0;
  return tblClientHasEmailColumn;
}

function asIsoDate(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  return s ? s.slice(0, 10) : null;
}

export async function executeCustomerListChanges(
  input: Record<string, unknown>,
): Promise<DrvowaToolResult> {
  try {
    const sinceClientId = parseOptionalNonNegativeInt(
      input.sinceClientId,
      'sinceClientId',
    );
    const limit = clampPageLimit(input.limit);

    const db = await getPool();
    const includeEmail = await hasEmailColumn(db);
    const emailSelect = includeEmail ? 'c.Email AS email' : 'CAST(NULL AS NVARCHAR(200)) AS email';

    const result = await db
      .request()
      .input('sinceClientId', sql.Int, sinceClientId)
      .input('limit', sql.Int, limit)
      .query(`
        SELECT TOP (@limit)
          c.ClientID AS clientId,
          c.[Name] AS name,
          c.Mobile AS mobile,
          c.Phone AS phone,
          ${emailSelect},
          c.RegisterDate AS registerDate,
          c.CameFrom AS cameFrom,
          c.State AS state
        FROM dbo.TblClient c
        WHERE c.ClientID > @sinceClientId
        ORDER BY c.ClientID ASC
      `);

    const customers = (result.recordset as Array<Record<string, unknown>>).map(
      (row) => ({
        clientId: Number(row.clientId),
        name: row.name != null ? String(row.name) : null,
        mobile: row.mobile != null ? String(row.mobile) : null,
        phone: row.phone != null ? String(row.phone) : null,
        email: row.email != null ? String(row.email) : null,
        registerDate: asIsoDate(row.registerDate),
        cameFrom: row.cameFrom != null ? String(row.cameFrom) : null,
        state: row.state != null ? String(row.state) : null,
      }),
    );

    const lastId = customers.length
      ? customers[customers.length - 1]!.clientId
      : null;

    return toolOk(TOOL, {
      customers,
      // Always advance when rows exist so AutoRespond can persist the high-water mark.
      nextCursor: lastId != null ? { sinceClientId: lastId } : null,
    });
  } catch (err) {
    if (err instanceof DrvowaValidationError) {
      return toolErr(TOOL, err.code, err.message);
    }
    console.error('[drvowa]', TOOL, err);
    return toolErr(TOOL, 'CUSTOMER_LIST_FAILED', 'Failed to list customers');
  }
}
