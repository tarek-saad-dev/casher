import 'server-only';
import { getPool, sql } from '@/lib/db';
import { toolErr, toolOk } from '../result';
import type { DrvowaToolResult } from '../types';
import { clampPageLimit, DrvowaValidationError, parseOptionalNonNegativeInt } from '../validate';

const TOOL = 'invoice.list_deletions';
const SALE_TYPE = 'مبيعات';

/**
 * Durable CRM cancellation cursor for ACTUAL hard-deleted sales.
 *
 * Unlike invoice.list_changes/statusSweep (which scans only existing headers),
 * a successful DELETE /api/sales/:id physically removes TblinvServHead.
 * The same transaction atomically writes a successful sensitive-action audit.
 * Scan only that append-only audit identity: never read OldData/NewData, customer
 * PII, IP addresses, reason, staff names or financial amounts.
 *
 * Cursor is AuditID, NOT invID. Deleting an old invoice must not be missed after
 * the CRM high-water mark has advanced beyond its invoice number.
 */
export async function executeInvoiceListDeletions(
  input: Record<string, unknown>,
  context: { tenantId: string },
): Promise<DrvowaToolResult> {
  try {
    // The authenticated route supplies this context; NEVER accept TenantId
    // from a CRM request body. Audit history is shared across all tenants.
    if (!context?.tenantId || !/^[a-f0-9-]{36}$/i.test(context.tenantId)) {
      throw new DrvowaValidationError('INVALID_TENANT_CONTEXT', 'Tenant context required');
    }
    const sinceAuditId = parseOptionalNonNegativeInt(input.sinceAuditId, 'sinceAuditId');
    const limit = clampPageLimit(input.limit);
    const db = await getPool();
    const result = await db.request()
      .input('sinceAuditId', sql.Int, sinceAuditId)
      .input('limit', sql.Int, limit)
      .input('tenantId', sql.UniqueIdentifier, context.tenantId)
      .input('actionType', sql.NVarChar(100), 'delete_invoice')
      .input('status', sql.NVarChar(30), 'success')
      .input('method', sql.NVarChar(20), 'DELETE')
      .query(`
        SELECT TOP (@limit)
          a.AuditID AS auditId,
          TRY_CONVERT(int, a.EntityID) AS invId
        FROM dbo.TblSensitiveActionAuditLog a WITH (READCOMMITTEDLOCK)
        WHERE a.AuditID > @sinceAuditId
          AND a.ActionType = @actionType
          AND a.ExecutionStatus = @status
          AND a.ActionMethod = @method
          AND a.EndpointPath LIKE N'/api/sales/%'
          AND TRY_CONVERT(int, a.EntityID) > 0
          -- The original paid invoice no longer exists. Its sanitized audit
          -- snapshot retains the immutable BranchID in $.header.BranchID.
          -- Extract ONLY that scalar inside SQL and require the authenticated
          -- DRVOWA-owned Tenant's Location. Never export OldData.
          AND EXISTS (
            SELECT 1 FROM dbo.Location l
            WHERE l.TenantId = @tenantId
              AND l.LegacyBranchId = TRY_CONVERT(int, JSON_VALUE(
                CASE WHEN ISJSON(a.OldData) = 1
                  THEN a.OldData ELSE N'{}' END,
                '$.header.BranchID'
              ))
          )
        ORDER BY a.AuditID ASC;
      `);

    const deletions = (result.recordset as Array<{ auditId: unknown; invId: unknown }>)
      .map(row => ({
        auditId: Number(row.auditId),
        invId: Number(row.invId),
        invType: SALE_TYPE,
        status: 'cancelled' as const,
        source: 'audited_hard_delete' as const,
      }));
    const nextAuditId = deletions.length
      ? deletions[deletions.length - 1].auditId
      : sinceAuditId;

    return toolOk(TOOL, {
      deletions,
      cursorSemantics: {
        sinceAuditId: 'append-only successful audited hard deletes; independent of invoice IDs',
        compositeKey: 'invType+invID',
        limitation: 'includes audited DELETE /api/sales/:id only; historic unaudited deletes are not recoverable',
      },
      nextCursor: { sinceAuditId: nextAuditId },
      hasMore: deletions.length === limit,
    });
  } catch (err) {
    if (err instanceof DrvowaValidationError) {
      return toolErr(TOOL, err.code, err.message);
    }
    console.error('[drvowa]', TOOL, 'failed');
    return toolErr(TOOL, 'INVOICE_DELETIONS_FAILED', 'Failed to list invoice deletions');
  }
}
