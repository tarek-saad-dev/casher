import sql from 'mssql';

const PROTECTED_TENANT_CODES = new Set(['CASHER_BOOT']);
const MAX_PASSES = 8;

type Target = { table: string; column: string; kind: 'tenant' | 'branch' | 'user' | 'location' };

/**
 * Removes every row that belongs to one synthetic smoke tenant, whatever DRVO branch added the table:
 * all `TenantId` / `LocationId` columns plus rows keyed by the tenant's legacy branch and user ids.
 * FK order is not known up front, so deletes repeat until a pass removes nothing. Refuses CASHER_BOOT.
 */
export async function purgeSmokeTenant(pool: sql.ConnectionPool, tenantCode: string): Promise<boolean> {
  if (PROTECTED_TENANT_CODES.has(tenantCode.toUpperCase())) {
    throw new Error(`Refusing to purge protected tenant ${tenantCode}`);
  }
  const tenant = await pool
    .request()
    .input('code', sql.NVarChar(64), tenantCode)
    .query(`SELECT TenantId FROM dbo.Tenant WHERE Code = @code;`);
  if (!tenant.recordset.length) return false;
  const tenantId = String(tenant.recordset[0].TenantId);

  const ids = async (query: string) =>
    (await pool.request().input('tenantId', sql.UniqueIdentifier, tenantId).query(query)).recordset.map(
      (r: { id: number | string }) => r.id,
    );
  // Only ids owned by this tenant alone; a user or branch shared with another tenant is never touched.
  const branchIds = (
    await ids(`
      SELECT l.LegacyBranchId AS id FROM dbo.Location l
      WHERE l.TenantId = @tenantId AND l.LegacyBranchId IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM dbo.Location o WHERE o.LegacyBranchId = l.LegacyBranchId AND o.TenantId <> @tenantId);`)
  ).map(Number);
  const userIds = (
    await ids(`
      SELECT m.LegacyUserId AS id FROM dbo.TenantMembership m
      WHERE m.TenantId = @tenantId AND m.LegacyUserId IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM dbo.TenantMembership o WHERE o.LegacyUserId = m.LegacyUserId AND o.TenantId <> @tenantId);`)
  ).map(Number);
  const locationIds = (await ids(`SELECT LocationId AS id FROM dbo.Location WHERE TenantId = @tenantId;`)).map(String);

  const columns = (
    await pool.request().query(`
      SELECT s.name + '.' + t.name AS tbl, c.name AS col
      FROM sys.columns c
      JOIN sys.tables t ON t.object_id = c.object_id
      JOIN sys.schemas s ON s.schema_id = t.schema_id
      WHERE s.name = 'dbo' AND c.name IN ('TenantId', 'LocationId', 'BranchID', 'BranchId', 'UserID', 'UserId', 'LegacyUserId', 'LegacyBranchId');
    `)
  ).recordset as { tbl: string; col: string }[];

  const targets: Target[] = [];
  for (const { tbl, col } of columns) {
    if (tbl === 'dbo.Tenant') continue;
    const lower = col.toLowerCase();
    if (lower === 'tenantid') targets.push({ table: tbl, column: col, kind: 'tenant' });
    else if (lower === 'locationid' && tbl !== 'dbo.Location') targets.push({ table: tbl, column: col, kind: 'location' });
    else if ((lower === 'branchid' || lower === 'legacybranchid') && tbl !== 'dbo.TblBranch') targets.push({ table: tbl, column: col, kind: 'branch' });
    else if ((lower === 'userid' || lower === 'legacyuserid') && tbl !== 'dbo.TblUser') targets.push({ table: tbl, column: col, kind: 'user' });
  }

  const runDelete = async (table: string, column: string, kind: Target['kind']): Promise<number> => {
    const req = pool.request();
    let where: string;
    if (kind === 'tenant') {
      req.input('v', sql.UniqueIdentifier, tenantId);
      where = `[${column}] = @v`;
    } else {
      const values = kind === 'branch' ? branchIds : kind === 'user' ? userIds : locationIds;
      if (!values.length) return 0;
      values.forEach((v, i) =>
        req.input(`v${i}`, kind === 'location' ? sql.UniqueIdentifier : sql.Int, v),
      );
      where = `[${column}] IN (${values.map((_, i) => `@v${i}`).join(', ')})`;
    }
    const [schema, name] = table.split('.');
    const r = await req.query(`DELETE FROM [${schema}].[${name}] WHERE ${where};`);
    return r.rowsAffected[0] ?? 0;
  };

  // Child tables without a tenant column (e.g. TblExpCatEmpMap) block deletes of their tenant-owned parents.
  const tenantTables = new Set(targets.filter((t) => t.kind === 'tenant').map((t) => t.table));
  const fks = (
    await pool.request().query(`
      SELECT cs.name + '.' + ct.name AS child, cc.name AS childCol,
             ps.name + '.' + pt.name AS parent, pc.name AS parentCol
      FROM sys.foreign_keys fk
      JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
      JOIN sys.tables ct ON ct.object_id = fk.parent_object_id
      JOIN sys.schemas cs ON cs.schema_id = ct.schema_id
      JOIN sys.columns cc ON cc.object_id = fkc.parent_object_id AND cc.column_id = fkc.parent_column_id
      JOIN sys.tables pt ON pt.object_id = fk.referenced_object_id
      JOIN sys.schemas ps ON ps.schema_id = pt.schema_id
      JOIN sys.columns pc ON pc.object_id = fkc.referenced_object_id AND pc.column_id = fkc.referenced_column_id
      WHERE (SELECT COUNT(*) FROM sys.foreign_key_columns x WHERE x.constraint_object_id = fk.object_id) = 1;
    `)
  ).recordset as { child: string; childCol: string; parent: string; parentCol: string }[];
  const childDeletes = fks.filter((f) => tenantTables.has(f.parent) && !tenantTables.has(f.child));
  const runChildDelete = async (f: (typeof childDeletes)[number]): Promise<number> => {
    const q = (t: string) => t.split('.').map((p) => `[${p}]`).join('.');
    const r = await pool
      .request()
      .input('v', sql.UniqueIdentifier, tenantId)
      .query(`DELETE FROM ${q(f.child)} WHERE [${f.childCol}] IN (SELECT [${f.parentCol}] FROM ${q(f.parent)} WHERE [TenantId] = @v);`);
    return r.rowsAffected[0] ?? 0;
  };

  const finals: Target[] = [
    ...(branchIds.length ? [{ table: 'dbo.TblBranch', column: 'BranchID', kind: 'branch' as const }] : []),
    ...(userIds.length ? [{ table: 'dbo.TblUser', column: 'UserID', kind: 'user' as const }] : []),
  ];

  let lastErrors: string[] = [];
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let deleted = 0;
    lastErrors = [];
    for (const f of childDeletes) {
      try {
        deleted += await runChildDelete(f);
      } catch (err) {
        lastErrors.push(`${f.child}.${f.childCol}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    for (const t of [...targets, ...finals]) {
      try {
        deleted += await runDelete(t.table, t.column, t.kind);
      } catch (err) {
        lastErrors.push(`${t.table}.${t.column}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    try {
      await pool.request().input('tenantId', sql.UniqueIdentifier, tenantId).query(`DELETE FROM dbo.Tenant WHERE TenantId = @tenantId;`);
    } catch (err) {
      lastErrors.push(`dbo.Tenant: ${err instanceof Error ? err.message : String(err)}`);
    }
    const left = await pool.request().input('tenantId', sql.UniqueIdentifier, tenantId).query(`SELECT COUNT(*) AS n FROM dbo.Tenant WHERE TenantId = @tenantId;`);
    if (Number(left.recordset[0].n) === 0 && lastErrors.length === 0) return true;
    if (deleted === 0 && Number(left.recordset[0].n) === 0) return true;
    if (deleted === 0 && pass > 0) break;
  }
  throw new Error(`purge of ${tenantCode} incomplete: ${lastErrors.slice(0, 3).join(' | ')}`);
}
