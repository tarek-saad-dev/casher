import 'server-only';
import { getPool, sql } from '@/lib/db';
import { toolErr, toolOk } from '../result';
import type { DrvowaToolResult } from '../types';
import {
  clampPageLimit,
  DRVOWA_PAGE_LIMIT_MAX,
  DrvowaValidationError,
  mapInvoiceSaleStatus,
  parseOptionalBoolean,
  parseOptionalNonNegativeInt,
} from '../validate';

const TOOL = 'invoice.list_changes';
const SALE_TYPE = 'مبيعات';

/**
 * Cursor contract for CRM sync:
 * - `sinceInvId` is append-only for newly inserted invIDs (ORDER BY invID ASC).
 * - `statusSweepSinceInvId` re-reads historical sales headers (including already-synced IDs)
 *   so late cancellations (`isActive='yes'`) are not permanently missed. When the sweep
 *   reaches the end of the table it wraps to 0 (retry-safe rotating reconcile).
 * - Call with `includeInactive: true` for the append stream so newly inserted cancelled
 *   rows are also visible.
 * - Composite identity remains `invType` + `invID` (sale type is always مبيعات here).
 */
function asIsoDate(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  return s ? s.slice(0, 10) : null;
}

function asNullableNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

type HeadRow = Record<string, unknown>;

async function loadLinesForInvIds(
  db: Awaited<ReturnType<typeof getPool>>,
  invIds: number[],
  tenantId: string,
): Promise<Map<number, Array<Record<string, unknown>>>> {
  const linesByInv = new Map<number, Array<Record<string, unknown>>>();
  if (!invIds.length) return linesByInv;
  if (invIds.length > DRVOWA_PAGE_LIMIT_MAX) {
    throw new DrvowaValidationError(
      'INVOICE_PAGE_OVERFLOW',
      'Invoice page exceeded safe parameter bound',
    );
  }

  const detailReq = db.request().input('invType', sql.NVarChar(20), SALE_TYPE);
  detailReq.input('tenantId', sql.UniqueIdentifier, tenantId);
  invIds.forEach((id, i) => {
    detailReq.input(`invId${i}`, sql.Int, id);
  });
  const placeholders = invIds.map((_, i) => `@invId${i}`).join(',');

  const detailResult = await detailReq.query(`
      SELECT
        d.invID AS invId,
        d.ProID AS proId,
        d.EmpID AS empId,
        d.Qty AS qty,
        d.SPrice AS sPrice,
        d.SPriceAfterDis AS sPriceAfterDis,
        ISNULL(NULLIF(LTRIM(RTRIM(d.ProType)), N''), p.ProType) AS proType,
        p.ProName AS proName,
        e.EmpName AS empName
      FROM dbo.TblinvServDetail d
      INNER JOIN dbo.TblinvServHead h
        ON h.invID = d.invID AND h.invType = d.invType
      INNER JOIN dbo.Location l
        ON l.LegacyBranchId = h.BranchID AND l.TenantId = @tenantId
      LEFT JOIN dbo.TblPro p ON p.ProID = d.ProID AND p.TenantId = @tenantId
      LEFT JOIN dbo.TblEmp e ON e.EmpID = d.EmpID AND e.TenantId = @tenantId
      WHERE d.invType = @invType
        AND d.invID IN (${placeholders})
      ORDER BY d.invID ASC, d.ProID ASC
    `);

  for (const row of detailResult.recordset as Array<Record<string, unknown>>) {
    const invId = Number(row.invId);
    const list = linesByInv.get(invId) ?? [];
    list.push({
      proId: asNullableNumber(row.proId),
      empId: asNullableNumber(row.empId),
      qty: asNullableNumber(row.qty) ?? 0,
      sPrice: asNullableNumber(row.sPrice) ?? 0,
      sPriceAfterDis: asNullableNumber(row.sPriceAfterDis) ?? 0,
      proType: row.proType != null ? String(row.proType) : null,
      proName: row.proName != null ? String(row.proName) : null,
      empName: row.empName != null ? String(row.empName) : null,
    });
    linesByInv.set(invId, list);
  }
  return linesByInv;
}

function mapInvoiceHeads(
  heads: HeadRow[],
  linesByInv: Map<number, Array<Record<string, unknown>>>,
) {
  return heads.map((row) => {
    const invId = Number(row.invId);
    const isActiveRaw = row.isActive == null ? null : String(row.isActive);
    const status = mapInvoiceSaleStatus(isActiveRaw);
    return {
      invId,
      invType: row.invType != null ? String(row.invType) : SALE_TYPE,
      invDate: asIsoDate(row.invDate),
      invTime: row.invTime != null ? String(row.invTime) : null,
      clientId: asNullableNumber(row.clientId),
      branchId: asNullableNumber(row.branchId),
      grandTotal: asNullableNumber(row.grandTotal) ?? 0,
      subTotal: asNullableNumber(row.subTotal) ?? 0,
      disVal: asNullableNumber(row.disVal) ?? 0,
      isActive: isActiveRaw,
      status,
      lines: linesByInv.get(invId) ?? [],
    };
  });
}

export async function executeInvoiceListChanges(
  input: Record<string, unknown>,
  context: { tenantId: string },
): Promise<DrvowaToolResult> {
  try {
    const sinceInvId = parseOptionalNonNegativeInt(input.sinceInvId, 'sinceInvId');
    const statusSweepSinceInvId = parseOptionalNonNegativeInt(
      input.statusSweepSinceInvId,
      'statusSweepSinceInvId',
    );
    const limit = clampPageLimit(input.limit);
    // Always supported for sync — CRM should pass true so cancelled rows can update mirrors.
    const includeInactive = parseOptionalBoolean(input.includeInactive, false);
    // When true, page is a status-sweep over historical IDs (including already synced).
    const statusSweep = parseOptionalBoolean(input.statusSweep, false);

    const db = await getPool();

    if (statusSweep) {
      // Rotating reconcile: never permanently miss late isActive flips on older invIDs.
      let sweepResult = await db
        .request()
        .input('sinceInvId', sql.Int, statusSweepSinceInvId)
        .input('limit', sql.Int, limit)
        .input('tenantId', sql.UniqueIdentifier, context.tenantId)
        .input('invType', sql.NVarChar(20), SALE_TYPE)
        .query(`
          SELECT TOP (@limit)
            h.invID AS invId,
            h.invType AS invType,
            h.invDate AS invDate,
            h.invTime AS invTime,
            h.ClientID AS clientId,
            h.BranchID AS branchId,
            h.GrandTotal AS grandTotal,
            h.SubTotal AS subTotal,
            h.DisVal AS disVal,
            h.isActive AS isActive
          FROM dbo.TblinvServHead h
          INNER JOIN dbo.Location l ON l.LegacyBranchId = h.BranchID
            AND l.TenantId = @tenantId
          WHERE h.invType = @invType
            AND h.invID > @sinceInvId
          ORDER BY h.invID ASC
        `);

      let heads = sweepResult.recordset as HeadRow[];
      let wrapped = false;
      if (!heads.length && statusSweepSinceInvId > 0) {
        wrapped = true;
        sweepResult = await db
          .request()
          .input('sinceInvId', sql.Int, 0)
          .input('limit', sql.Int, limit)
        .input('tenantId', sql.UniqueIdentifier, context.tenantId)
          .input('invType', sql.NVarChar(20), SALE_TYPE)
          .query(`
            SELECT TOP (@limit)
              h.invID AS invId,
              h.invType AS invType,
              h.invDate AS invDate,
              h.invTime AS invTime,
              h.ClientID AS clientId,
              h.BranchID AS branchId,
              h.GrandTotal AS grandTotal,
              h.SubTotal AS subTotal,
              h.DisVal AS disVal,
              h.isActive AS isActive
            FROM dbo.TblinvServHead h
          INNER JOIN dbo.Location l ON l.LegacyBranchId = h.BranchID
            AND l.TenantId = @tenantId
            WHERE h.invType = @invType
              AND h.invID > @sinceInvId
            ORDER BY h.invID ASC
          `);
        heads = sweepResult.recordset as HeadRow[];
      }

      const invIds = heads
        .map((row) => Number(row.invId))
        .filter((id) => Number.isFinite(id) && Number.isInteger(id) && id > 0);
      const linesByInv = await loadLinesForInvIds(db, invIds, context.tenantId);
      const invoices = mapInvoiceHeads(heads, linesByInv);
      const lastId = invoices.length ? invoices[invoices.length - 1]!.invId : null;

      return toolOk(TOOL, {
        invoices,
        mode: 'status_sweep',
        wrapped,
        cursorSemantics: {
          statusSweepSinceInvId:
            'rotating historical status reconcile; wraps to 0 at end so late cancellations are not permanently missed',
        },
        nextCursor:
          lastId != null
            ? { statusSweepSinceInvId: lastId, sinceInvId }
            : { statusSweepSinceInvId: 0, sinceInvId },
      });
    }

    const activeFilter = includeInactive
      ? ''
      : `AND ISNULL(h.isActive, N'no') = N'no'`;

    const headResult = await db
      .request()
      .input('sinceInvId', sql.Int, sinceInvId)
      .input('limit', sql.Int, limit)
        .input('tenantId', sql.UniqueIdentifier, context.tenantId)
      .input('invType', sql.NVarChar(20), SALE_TYPE)
      .query(`
        SELECT TOP (@limit)
          h.invID AS invId,
          h.invType AS invType,
          h.invDate AS invDate,
          h.invTime AS invTime,
          h.ClientID AS clientId,
          h.BranchID AS branchId,
          h.GrandTotal AS grandTotal,
          h.SubTotal AS subTotal,
          h.DisVal AS disVal,
          h.isActive AS isActive
        FROM dbo.TblinvServHead h
          INNER JOIN dbo.Location l ON l.LegacyBranchId = h.BranchID
            AND l.TenantId = @tenantId
        WHERE h.invType = @invType
          AND h.invID > @sinceInvId
          ${activeFilter}
        ORDER BY h.invID ASC
      `);

    const heads = headResult.recordset as HeadRow[];
    const invIds = heads
      .map((row) => Number(row.invId))
      .filter((id) => Number.isFinite(id) && Number.isInteger(id) && id > 0);

    if (invIds.length > DRVOWA_PAGE_LIMIT_MAX) {
      return toolErr(
        TOOL,
        'INVOICE_PAGE_OVERFLOW',
        'Invoice page exceeded safe parameter bound',
      );
    }

    const linesByInv = await loadLinesForInvIds(db, invIds, context.tenantId);
    const invoices = mapInvoiceHeads(heads, linesByInv);
    const lastId = invoices.length ? invoices[invoices.length - 1]!.invId : null;

    return toolOk(TOOL, {
      invoices,
      mode: 'append',
      cursorSemantics: {
        sinceInvId: 'append-only-new-ids',
        statusSweepSinceInvId:
          'use statusSweep=true on a later call to reconcile late cancellations of already-seen IDs',
        includeInactive:
          'when true, cancelled sales (isActive=yes) are included so CRM can invalidate mirrors',
      },
      nextCursor: lastId != null
        ? {
            sinceInvId: lastId,
            statusSweepSinceInvId,
          }
        : null,
    });
  } catch (err) {
    if (err instanceof DrvowaValidationError) {
      return toolErr(TOOL, err.code, err.message);
    }
    console.error('[drvowa]', TOOL, 'failed');
    return toolErr(TOOL, 'INVOICE_LIST_FAILED', 'Failed to list invoices');
  }
}
