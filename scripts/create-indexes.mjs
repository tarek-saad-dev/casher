/**
 * Direct database index creation script
 * Run: node scripts/create-indexes.mjs
 */

import sql from 'mssql';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const config = {
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '1433'),
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
  },
};

const INDEXES = [
  {
    name: "IX_QueueTickets_EmpID_QueueDate_Status",
    table: "QueueTickets",
    columns: ["EmpID", "QueueDate", "Status"],
    includes: ["ServiceStartedAt", "DurationMinutes", "TicketCode"],
  },
  {
    name: "IX_Bookings_AssignedEmpID_BookingDate_Status",
    table: "Bookings",
    columns: ["AssignedEmpID", "BookingDate", "Status"],
    includes: ["StartTime", "EndTime"],
  },
  {
    name: "IX_Bookings_EmpID_BookingDate_Status",
    table: "Bookings",
    columns: ["EmpID", "BookingDate", "Status"],
    includes: ["StartTime", "EndTime"],
  },
  {
    name: "IX_TblEmpWorkSchedule_EmpID_DayOfWeek",
    table: "TblEmpWorkSchedule",
    columns: ["EmpID", "DayOfWeek"],
    includes: ["IsWorkingDay", "StartTime", "EndTime"],
  },
  {
    name: "IX_TblEmpDayOff_EmpID_OffDate",
    table: "TblEmpDayOff",
    columns: ["EmpID", "OffDate"],
    includes: [],
  },
];

async function checkTableExists(pool, tableName) {
  const result = await pool.request().query(`
    SELECT OBJECT_ID('dbo.${tableName}') as oid
  `);
  return result.recordset[0].oid !== null;
}

async function checkColumnExists(pool, tableName, columnName) {
  const result = await pool.request().query(`
    SELECT COUNT(*) as count
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = '${tableName}' AND COLUMN_NAME = '${columnName}'
  `);
  return result.recordset[0].count > 0;
}

async function checkIndexExists(pool, tableName, indexName) {
  const result = await pool.request().query(`
    SELECT COUNT(*) as count
    FROM sys.indexes
    WHERE name = '${indexName}'
      AND object_id = OBJECT_ID('dbo.${tableName}')
  `);
  return result.recordset[0].count > 0;
}

async function createIndexes() {
  console.log('='.repeat(80));
  console.log('BOOKING INDEXES MIGRATION');
  console.log('='.repeat(80));
  
  const pool = await sql.connect(config);
  console.log('✅ Connected to database\n');
  
  const results = {
    created: [],
    skipped: [],
    errors: [],
  };
  
  for (const idx of INDEXES) {
    console.log(`\n📋 ${idx.name}`);
    console.log(`   Table: ${idx.table}`);
    console.log(`   Columns: ${idx.columns.join(', ')}`);
    
    try {
      // Check table exists
      const hasTable = await checkTableExists(pool, idx.table);
      if (!hasTable) {
        console.log(`   ⚠️ SKIPPED: Table ${idx.table} does not exist`);
        results.skipped.push({ name: idx.name, reason: 'Table does not exist' });
        continue;
      }
      
      // Check required columns exist
      const missingCols = [];
      for (const col of idx.columns) {
        const hasCol = await checkColumnExists(pool, idx.table, col);
        if (!hasCol) missingCols.push(col);
      }
      if (missingCols.length > 0) {
        console.log(`   ⚠️ SKIPPED: Missing columns: ${missingCols.join(', ')}`);
        results.skipped.push({ name: idx.name, reason: `Missing columns: ${missingCols.join(', ')}` });
        continue;
      }
      
      // Check if index already exists
      const exists = await checkIndexExists(pool, idx.table, idx.name);
      if (exists) {
        console.log(`   ⚠️ SKIPPED: Index already exists`);
        results.skipped.push({ name: idx.name, reason: 'Already exists' });
        continue;
      }
      
      // Check which include columns exist
      const existingIncludes = [];
      for (const col of idx.includes || []) {
        const hasCol = await checkColumnExists(pool, idx.table, col);
        if (hasCol) existingIncludes.push(col);
      }
      
      // Build CREATE INDEX
      const columnList = idx.columns.join(', ');
      const includeClause = existingIncludes.length > 0
        ? `INCLUDE (${existingIncludes.join(', ')})`
        : '';
      
      const createSql = `
        CREATE NONCLUSTERED INDEX ${idx.name}
        ON dbo.${idx.table} (${columnList})
        ${includeClause}
      `;
      
      console.log(`   📝 Creating index...`);
      await pool.request().query(createSql);
      console.log(`   ✅ CREATED`);
      results.created.push(idx.name);
      
    } catch (err) {
      console.log(`   ❌ ERROR: ${err.message}`);
      results.errors.push({ name: idx.name, error: err.message });
    }
  }
  
  await pool.close();
  
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Created: ${results.created.length}`);
  console.log(`Skipped: ${results.skipped.length}`);
  console.log(`Errors: ${results.errors.length}`);
  
  if (results.created.length > 0) {
    console.log('\n✅ Indexes created:');
    results.created.forEach(name => console.log(`   - ${name}`));
  }
  
  if (results.skipped.length > 0) {
    console.log('\n⚠️ Skipped:');
    results.skipped.forEach(s => console.log(`   - ${s.name}: ${s.reason}`));
  }
  
  if (results.errors.length > 0) {
    console.log('\n❌ Errors:');
    results.errors.forEach(e => console.log(`   - ${e.name}: ${e.error}`));
  }
  
  process.exit(results.errors.length > 0 ? 1 : 0);
}

createIndexes().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
