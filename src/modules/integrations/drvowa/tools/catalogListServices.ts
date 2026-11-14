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

const TOOL = 'catalog.list_services';

type ProRow = Record<string, unknown>;

function mapServices(rows: ProRow[]) {
  return rows.map((row) => ({
    proId: Number(row.proId),
    proType: row.proType != null ? String(row.proType) : null,
    proName: row.proName != null ? String(row.proName) : null,
    proNameAr: row.proNameAr != null ? String(row.proNameAr) : null,
    categoryName: row.categoryName != null ? String(row.categoryName) : null,
    isDeleted: Number(row.isDeleted) === 1,
  }));
}

/**
 * Cursor contract:
 * - `sinceProId` append-only for newly inserted ProIDs.
 * - `identitySweep=true` + `identitySweepSinceProId` rotates through historical IDs
 *   so renames, category moves, and isDeleted flips are not permanently missed.
 */
export async function executeCatalogListServices(
  input: Record<string, unknown>,
): Promise<DrvowaToolResult> {
  try {
    const sinceProId = parseOptionalNonNegativeInt(input.sinceProId, 'sinceProId');
    const identitySweepSinceProId = parseOptionalNonNegativeInt(
      input.identitySweepSinceProId,
      'identitySweepSinceProId',
    );
    const limit = clampPageLimit(input.limit);
    const identitySweep = parseOptionalBoolean(input.identitySweep, false);

    const db = await getPool();
    const selectSql = `
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
    `;

    if (identitySweep) {
      let result = await db
        .request()
        .input('sinceProId', sql.Int, identitySweepSinceProId)
        .input('limit', sql.Int, limit)
        .query(selectSql);
      let rows = result.recordset as ProRow[];
      let wrapped = false;
      if (!rows.length && identitySweepSinceProId > 0) {
        wrapped = true;
        result = await db
          .request()
          .input('sinceProId', sql.Int, 0)
          .input('limit', sql.Int, limit)
          .query(selectSql);
        rows = result.recordset as ProRow[];
      }
      const services = mapServices(rows);
      const lastId = services.length ? services[services.length - 1]!.proId : null;
      return toolOk(TOOL, {
        services,
        mode: 'identity_sweep',
        wrapped,
        cursorSemantics: {
          identitySweepSinceProId:
            'rotating historical catalog reconcile; wraps to 0 so renames/deletes of already-synced ProIDs are not permanently missed',
        },
        nextCursor:
          lastId != null
            ? { identitySweepSinceProId: lastId, sinceProId }
            : { identitySweepSinceProId: 0, sinceProId },
      });
    }

    const result = await db
      .request()
      .input('sinceProId', sql.Int, sinceProId)
      .input('limit', sql.Int, limit)
      .query(selectSql);

    const services = mapServices(result.recordset as ProRow[]);
    const lastId = services.length ? services[services.length - 1]!.proId : null;

    return toolOk(TOOL, {
      services,
      mode: 'append',
      cursorSemantics: {
        sinceProId: 'append-only-new-ids',
        identitySweepSinceProId:
          'use identitySweep=true on a later call to reconcile updates to already-seen ProIDs',
      },
      nextCursor:
        lastId != null
          ? { sinceProId: lastId, identitySweepSinceProId }
          : null,
    });
  } catch (err) {
    if (err instanceof DrvowaValidationError) {
      return toolErr(TOOL, err.code, err.message);
    }
    console.error('[drvowa]', TOOL, 'failed');
    return toolErr(TOOL, 'CATALOG_LIST_FAILED', 'Failed to list services');
  }
}
