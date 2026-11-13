import 'server-only';
import { getPool, sql } from '@/lib/db';
import { toolErr, toolOk } from '../result';
import type { DrvowaToolResult } from '../types';
import {
  clampPageLimit,
  DrvowaValidationError,
  parseOptionalNonNegativeInt,
} from '../validate';

const TOOL = 'catalog.list_services';

export async function executeCatalogListServices(
  input: Record<string, unknown>,
): Promise<DrvowaToolResult> {
  try {
    const sinceProId = parseOptionalNonNegativeInt(input.sinceProId, 'sinceProId');
    const limit = clampPageLimit(input.limit);

    const db = await getPool();
    const result = await db
      .request()
      .input('sinceProId', sql.Int, sinceProId)
      .input('limit', sql.Int, limit)
      .query(`
        SELECT TOP (@limit)
          p.ProID AS proId,
          ISNULL(p.ProType, N'') AS proType,
          p.ProName AS proName,
          p.ProNameAr AS proNameAr,
          c.CatName AS categoryName,
          CASE WHEN ISNULL(p.isDeleted, 0) = 1 THEN 1 ELSE 0 END AS isDeleted
        FROM dbo.TblPro p
        LEFT JOIN dbo.TblCat c ON c.CatID = p.CatID
        WHERE p.ProID > @sinceProId
        ORDER BY p.ProID ASC
      `);

    const services = (result.recordset as Array<Record<string, unknown>>).map(
      (row) => ({
        proId: Number(row.proId),
        proType: row.proType != null ? String(row.proType) : null,
        proName: row.proName != null ? String(row.proName) : null,
        proNameAr: row.proNameAr != null ? String(row.proNameAr) : null,
        categoryName: row.categoryName != null ? String(row.categoryName) : null,
        isDeleted: Number(row.isDeleted) === 1,
      }),
    );

    const lastId = services.length
      ? services[services.length - 1]!.proId
      : null;

    return toolOk(TOOL, {
      services,
      nextCursor: lastId != null ? { sinceProId: lastId } : null,
    });
  } catch (err) {
    if (err instanceof DrvowaValidationError) {
      return toolErr(TOOL, err.code, err.message);
    }
    console.error('[drvowa]', TOOL, err);
    return toolErr(TOOL, 'CATALOG_LIST_FAILED', 'Failed to list services');
  }
}
