import 'server-only';

import { getPool, sql } from '@/lib/db';
import { toolErr, toolOk } from '../result';
import type { DrvowaToolResult } from '../types';

const TOOL = 'sync.source_counts';

/**
 * Instance-scoped, bearer-authenticated READ tool.
 * Counts the *same source sets* as the CRM append streams:
 * - all client IDs, including records without phones
 * - all sales invoice headers, including cancelled/invalid ones
 * - all catalog ProIDs, including soft-deleted products
 *
 * No PII, no SQL writes, and no total inferred from highest ID (gaps exist).
 * Each count is a snapshot and may change after it is read.
 */
export async function executeSourceSyncCounts(): Promise<DrvowaToolResult> {
  try {
    const db = await getPool();
    const results = await db.request()
      .input('saleType', sql.NVarChar(20), 'مبيعات')
      .query(`
        SELECT
          (SELECT COUNT_BIG(1) FROM dbo.TblClient) AS customers,
          (SELECT COUNT_BIG(1) FROM dbo.TblinvServHead
             WHERE invType = @saleType) AS invoices,
          (SELECT COUNT_BIG(1) FROM dbo.TblPro) AS catalog,
          SYSUTCDATETIME() AS asOfUtc
      `);
    const row = results.recordset[0];
    const customers = Number(row?.customers);
    const invoices = Number(row?.invoices);
    const catalog = Number(row?.catalog);
    const asOfUtc = row?.asOfUtc instanceof Date
      ? row.asOfUtc.toISOString()
      : new Date(String(row?.asOfUtc ?? '')).toISOString();
    if (![customers, invoices, catalog].every((n) => Number.isSafeInteger(n) && n >= 0)) {
      return toolErr(TOOL, 'INVALID_SOURCE_COUNTS', 'Invalid source counts');
    }
    return toolOk(TOOL, { customers, invoices, catalog, asOfUtc });
  } catch {
    console.error('[drvowa]', TOOL, 'read-only source count failed');
    return toolErr(TOOL, 'SOURCE_COUNTS_UNAVAILABLE', 'Unable to read source counts');
  }
}
