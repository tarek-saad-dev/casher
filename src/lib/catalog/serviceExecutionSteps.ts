import type { ConnectionPool } from 'mssql';
import { sql } from '@/lib/db';
import type {
  ExecutionStepInput,
  ExecutionStepRow,
  PublicExecutionStepWire,
} from '@/lib/catalog/serviceExecutionSteps.types';

const STEP_SELECT = `
  s.StepID,
  s.ProID,
  s.SortOrder,
  s.TitleAr,
  s.TitleEn,
  s.DetailAr,
  s.DetailEn,
  s.DurationMinutes,
  s.CreatedAt,
  s.UpdatedAt
`;

function mapStepRow(row: Record<string, unknown>): ExecutionStepRow {
  return {
    StepID: Number(row.StepID),
    ProID: Number(row.ProID),
    SortOrder: Number(row.SortOrder) || 0,
    TitleAr: row.TitleAr != null ? String(row.TitleAr) : null,
    TitleEn: row.TitleEn != null ? String(row.TitleEn) : null,
    DetailAr: row.DetailAr != null ? String(row.DetailAr) : null,
    DetailEn: row.DetailEn != null ? String(row.DetailEn) : null,
    DurationMinutes: row.DurationMinutes != null ? Number(row.DurationMinutes) : null,
    CreatedAt: row.CreatedAt != null ? String(row.CreatedAt) : null,
    UpdatedAt: row.UpdatedAt != null ? String(row.UpdatedAt) : null,
  };
}

function trimOrNull(value: unknown, maxLen: number): string | null {
  const s = String(value ?? '').trim();
  if (!s) return null;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

export function normalizeExecutionSteps(
  raw: ExecutionStepInput[] | undefined | null,
): ExecutionStepInput[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((step, i) => {
    const durationRaw = step.DurationMinutes;
    let DurationMinutes: number | null = null;
    if (durationRaw !== undefined && durationRaw !== null && String(durationRaw).trim() !== '') {
      const n = Number(durationRaw);
      if (Number.isFinite(n) && n > 0) {
        DurationMinutes = Math.min(Math.round(n), 1440);
      }
    }
    return {
      TitleAr: trimOrNull(step.TitleAr, 200),
      TitleEn: trimOrNull(step.TitleEn, 200),
      DetailAr: trimOrNull(step.DetailAr, 1000),
      DetailEn: trimOrNull(step.DetailEn, 1000),
      DurationMinutes,
      SortOrder: Number.isFinite(Number(step.SortOrder))
        ? Number(step.SortOrder)
        : (i + 1) * 10,
    };
  }).filter((step) =>
    Boolean(step.TitleAr || step.TitleEn || step.DetailAr || step.DetailEn),
  );
}

export function validateExecutionStepsBody(
  body: unknown,
): { ok: true; steps: ExecutionStepInput[] } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'بيانات غير صالحة' };
  }
  const stepsRaw = (body as { steps?: unknown }).steps;
  if (stepsRaw === undefined) {
    return { ok: false, error: 'حقل steps مطلوب' };
  }
  if (!Array.isArray(stepsRaw)) {
    return { ok: false, error: 'steps يجب أن تكون مصفوفة' };
  }
  if (stepsRaw.length > 50) {
    return { ok: false, error: 'الحد الأقصى 50 خطوة لكل خدمة' };
  }
  for (const step of stepsRaw) {
    if (!step || typeof step !== 'object') {
      return { ok: false, error: 'كل خطوة يجب أن تكون كائناً' };
    }
  }
  return { ok: true, steps: normalizeExecutionSteps(stepsRaw as ExecutionStepInput[]) };
}

export async function listStepsByProId(
  db: ConnectionPool,
  proId: number,
): Promise<ExecutionStepRow[]> {
  const result = await db
    .request()
    .input('ProID', sql.Int, proId)
    .query(`
      SELECT ${STEP_SELECT}
      FROM dbo.TblProExecutionStep s
      WHERE s.ProID = @ProID
      ORDER BY s.SortOrder, s.StepID
    `);

  return (result.recordset as Record<string, unknown>[]).map(mapStepRow);
}

export async function replaceSteps(
  db: ConnectionPool,
  proId: number,
  steps: ExecutionStepInput[],
): Promise<ExecutionStepRow[]> {
  const normalized = normalizeExecutionSteps(steps);
  const tx = new sql.Transaction(db);
  await tx.begin();
  try {
    await new sql.Request(tx)
      .input('ProID', sql.Int, proId)
      .query(`DELETE FROM dbo.TblProExecutionStep WHERE ProID = @ProID`);

    for (let i = 0; i < normalized.length; i++) {
      const step = normalized[i];
      const sortOrder = Number.isFinite(Number(step.SortOrder))
        ? Number(step.SortOrder)
        : (i + 1) * 10;
      await new sql.Request(tx)
        .input('ProID', sql.Int, proId)
        .input('SortOrder', sql.Int, sortOrder)
        .input('TitleAr', sql.NVarChar(200), step.TitleAr)
        .input('TitleEn', sql.NVarChar(200), step.TitleEn)
        .input('DetailAr', sql.NVarChar(1000), step.DetailAr)
        .input('DetailEn', sql.NVarChar(1000), step.DetailEn)
        .input('DurationMinutes', sql.Int, step.DurationMinutes ?? null)
        .query(`
          INSERT INTO dbo.TblProExecutionStep (
            ProID, SortOrder, TitleAr, TitleEn, DetailAr, DetailEn, DurationMinutes
          )
          VALUES (
            @ProID, @SortOrder, @TitleAr, @TitleEn, @DetailAr, @DetailEn, @DurationMinutes
          )
        `);
    }
    await tx.commit();
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      /* ignore */
    }
    throw err;
  }

  return listStepsByProId(db, proId);
}

export async function proExists(db: ConnectionPool, proId: number): Promise<boolean> {
  const result = await db
    .request()
    .input('ProID', sql.Int, proId)
    .query(`SELECT TOP 1 ProID FROM dbo.TblPro WHERE ProID = @ProID`);
  return Boolean(result.recordset[0]);
}

/** Active (non soft-deleted) service only — for public reads. */
export async function activeProExists(db: ConnectionPool, proId: number): Promise<boolean> {
  const result = await db
    .request()
    .input('ProID', sql.Int, proId)
    .query(`
      SELECT TOP 1 ProID
      FROM dbo.TblPro
      WHERE ProID = @ProID AND ISNULL(isDeleted, 0) = 0
    `);
  return Boolean(result.recordset[0]);
}

export function toPublicExecutionStepWire(
  rows: ExecutionStepRow[],
): PublicExecutionStepWire[] {
  return rows.map((row, index) => ({
    stepId: row.StepID,
    sortOrder: row.SortOrder,
    order: index + 1,
    titleAr: row.TitleAr,
    titleEn: row.TitleEn,
    detailAr: row.DetailAr,
    detailEn: row.DetailEn,
    durationMinutes: row.DurationMinutes,
  }));
}

/** Map of ProID → step count for catalog badges. Empty map if table missing. */
export async function countStepsByProIds(
  db: ConnectionPool,
  proIds: number[],
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  const unique = [...new Set(proIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (unique.length === 0) return map;

  // Chunk to stay under SQL Server parameter limits for large catalogs
  const CHUNK = 200;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const request = db.request();
    const placeholders = chunk
      .map((id, idx) => {
        request.input(`p${idx}`, sql.Int, id);
        return `@p${idx}`;
      })
      .join(', ');
    const result = await request.query(`
      SELECT ProID, COUNT(*) AS StepCount
      FROM dbo.TblProExecutionStep
      WHERE ProID IN (${placeholders})
      GROUP BY ProID
    `);
    for (const row of result.recordset as Array<{ ProID: number; StepCount: number }>) {
      map.set(Number(row.ProID), Number(row.StepCount) || 0);
    }
  }
  return map;
}
