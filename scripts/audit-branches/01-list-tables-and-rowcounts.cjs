#!/usr/bin/env node
/**
 * READ-ONLY: list user tables and row counts.
 * Usage: node scripts/audit-branches/01-list-tables-and-rowcounts.mjs
 */
const { connectReadOnly } = require('./_db.cjs');

async function main() {
  const { pool } = await connectReadOnly();
  try {
    const result = await pool.request().query(`
      SELECT
        s.name AS schema_name,
        t.name AS table_name,
        SUM(p.rows) AS approx_rows
      FROM sys.tables t
      INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
      INNER JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
      WHERE t.is_ms_shipped = 0
      GROUP BY s.name, t.name
      ORDER BY s.name, t.name;
    `);

    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), tables: result.recordset }, null, 2));
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
