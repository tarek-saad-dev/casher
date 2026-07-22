#!/usr/bin/env node
/**
 * READ-ONLY: list PK, unique constraints/indexes, FKs.
 * Usage: node scripts/audit-branches/02-list-constraints-and-indexes.mjs
 */
const { connectReadOnly } = require('./_db.cjs');

async function main() {
  const { pool } = await connectReadOnly();
  try {
    const pks = await pool.request().query(`
      SELECT
        s.name AS schema_name,
        t.name AS table_name,
        kc.name AS constraint_name,
        COL_NAME(ic.object_id, ic.column_id) AS column_name,
        ic.key_ordinal
      FROM sys.key_constraints kc
      INNER JOIN sys.tables t ON t.object_id = kc.parent_object_id
      INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
      INNER JOIN sys.index_columns ic
        ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
      WHERE kc.type = 'PK'
      ORDER BY s.name, t.name, ic.key_ordinal;
    `);

    const uniques = await pool.request().query(`
      SELECT
        s.name AS schema_name,
        t.name AS table_name,
        i.name AS index_name,
        i.is_unique_constraint,
        i.has_filter,
        i.filter_definition,
        COL_NAME(ic.object_id, ic.column_id) AS column_name,
        ic.key_ordinal
      FROM sys.indexes i
      INNER JOIN sys.tables t ON t.object_id = i.object_id
      INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
      INNER JOIN sys.index_columns ic
        ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
      WHERE i.is_unique = 1 AND i.is_primary_key = 0 AND t.is_ms_shipped = 0
      ORDER BY s.name, t.name, i.name, ic.key_ordinal;
    `);

    const fks = await pool.request().query(`
      SELECT
        OBJECT_SCHEMA_NAME(fk.parent_object_id) AS schema_name,
        OBJECT_NAME(fk.parent_object_id) AS table_name,
        fk.name AS fk_name,
        COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS column_name,
        OBJECT_SCHEMA_NAME(fk.referenced_object_id) AS ref_schema,
        OBJECT_NAME(fk.referenced_object_id) AS ref_table,
        COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS ref_column,
        fk.delete_referential_action_desc,
        fk.update_referential_action_desc
      FROM sys.foreign_keys fk
      INNER JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
      ORDER BY schema_name, table_name, fk_name;
    `);

    console.log(
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          primaryKeys: pks.recordset,
          uniqueIndexes: uniques.recordset,
          foreignKeys: fks.recordset,
        },
        null,
        2
      )
    );
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
