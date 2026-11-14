import 'server-only';
import { getPool, sql } from '@/lib/db';
import { toolErr, toolOk } from '../result';
import type { DrvowaToolResult } from '../types';
import {
  clampPageLimit,
  DrvowaValidationError,
  parseOptionalBoolean,
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

type ClientRow = Record<string, unknown>;

function mapCustomers(rows: ClientRow[]) {
  return rows.map((row) => ({
    clientId: Number(row.clientId),
    name: row.name != null ? String(row.name) : null,
    mobile: row.mobile != null ? String(row.mobile) : null,
    phone: row.phone != null ? String(row.phone) : null,
    email: row.email != null ? String(row.email) : null,
    registerDate: asIsoDate(row.registerDate),
    cameFrom: row.cameFrom != null ? String(row.cameFrom) : null,
    state: row.state != null ? String(row.state) : null,
  }));
}

/**
 * Cursor contract:
 * - `sinceClientId` append-only for newly inserted ClientIDs.
 * - `identitySweep=true` + `identitySweepSinceClientId` rotates through historical IDs
 *   so name/phone/email edits and state changes are not permanently missed.
 */
export async function executeCustomerListChanges(
  input: Record<string, unknown>,
  context: { tenantId: string },
): Promise<DrvowaToolResult> {
  try {
    const sinceClientId = parseOptionalNonNegativeInt(
      input.sinceClientId,
      'sinceClientId',
    );
    const identitySweepSinceClientId = parseOptionalNonNegativeInt(
      input.identitySweepSinceClientId,
      'identitySweepSinceClientId',
    );
    const limit = clampPageLimit(input.limit);
    const identitySweep = parseOptionalBoolean(input.identitySweep, false);

    const db = await getPool();
    const includeEmail = await hasEmailColumn(db);
    const emailSelect = includeEmail
      ? 'c.Email AS email'
      : 'CAST(NULL AS NVARCHAR(200)) AS email';

    const selectSql = `
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
      WHERE c.ClientID > @sinceClientId AND c.TenantId = @tenantId
      ORDER BY c.ClientID ASC
    `;

    if (identitySweep) {
      let result = await db
        .request()
        .input('sinceClientId', sql.Int, identitySweepSinceClientId)
        .input('limit', sql.Int, limit)
        .input('tenantId', sql.UniqueIdentifier, context.tenantId)
        .query(selectSql);
      let rows = result.recordset as ClientRow[];
      let wrapped = false;
      if (!rows.length && identitySweepSinceClientId > 0) {
        wrapped = true;
        result = await db
          .request()
          .input('sinceClientId', sql.Int, 0)
          .input('limit', sql.Int, limit)
        .input('tenantId', sql.UniqueIdentifier, context.tenantId)
          .query(selectSql);
        rows = result.recordset as ClientRow[];
      }
      const customers = mapCustomers(rows);
      const lastId = customers.length ? customers[customers.length - 1]!.clientId : null;
      return toolOk(TOOL, {
        customers,
        mode: 'identity_sweep',
        wrapped,
        cursorSemantics: {
          identitySweepSinceClientId:
            'rotating historical identity reconcile; wraps to 0 so updates to already-synced clients are not permanently missed',
        },
        nextCursor:
          lastId != null
            ? { identitySweepSinceClientId: lastId, sinceClientId }
            : { identitySweepSinceClientId: 0, sinceClientId },
      });
    }

    const result = await db
      .request()
      .input('sinceClientId', sql.Int, sinceClientId)
      .input('limit', sql.Int, limit)
        .input('tenantId', sql.UniqueIdentifier, context.tenantId)
      .query(selectSql);

    const customers = mapCustomers(result.recordset as ClientRow[]);
    const lastId = customers.length ? customers[customers.length - 1]!.clientId : null;

    return toolOk(TOOL, {
      customers,
      mode: 'append',
      cursorSemantics: {
        sinceClientId: 'append-only-new-ids',
        identitySweepSinceClientId:
          'use identitySweep=true on a later call to reconcile updates to already-seen ClientIDs',
      },
      nextCursor:
        lastId != null
          ? { sinceClientId: lastId, identitySweepSinceClientId }
          : null,
    });
  } catch (err) {
    if (err instanceof DrvowaValidationError) {
      return toolErr(TOOL, err.code, err.message);
    }
    console.error('[drvowa]', TOOL, 'failed');
    return toolErr(TOOL, 'CUSTOMER_LIST_FAILED', 'Failed to list customers');
  }
}
