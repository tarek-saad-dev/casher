/**
 * Script: Inspect TblinvServDetail Schema
 * Purpose: Find the correct column names for employee revenue calculation
 */

const sql = require('mssql');

const config = {
  server: process.env.DB_SERVER || 'DESKTOP-EUN2CV2',
  database: process.env.DB_NAME || 'HawaiDB',
  user: process.env.DB_USER || 'it',
  password: process.env.DB_PASSWORD || '123',
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
  },
  connectionTimeout: 15000,
  requestTimeout: 30000,
};

async function main() {
  let pool;
  
  try {
    console.log('Connecting to database...');
    pool = await sql.connect(config);
    console.log('✓ Connected\n');
    
    // Get table schema
    console.log('='.repeat(60));
    console.log('TblinvServDetail Schema');
    console.log('='.repeat(60));
    
    const schemaResult = await pool.request().query(`
      SELECT 
        COLUMN_NAME,
        DATA_TYPE,
        CHARACTER_MAXIMUM_LENGTH,
        IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'TblinvServDetail'
      ORDER BY ORDINAL_POSITION
    `);
    
    console.log('\nColumns:');
    schemaResult.recordset.forEach(col => {
      const length = col.CHARACTER_MAXIMUM_LENGTH ? `(${col.CHARACTER_MAXIMUM_LENGTH})` : '';
      const nullable = col.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL';
      console.log(`  ${col.COLUMN_NAME.padEnd(30)} ${col.DATA_TYPE}${length.padEnd(10)} ${nullable}`);
    });
    
    // Get sample data
    console.log('\n' + '='.repeat(60));
    console.log('Sample Data (Top 5 rows)');
    console.log('='.repeat(60));
    
    const sampleResult = await pool.request().query(`
      SELECT TOP 5 * FROM [dbo].[TblinvServDetail]
    `);
    
    if (sampleResult.recordset.length > 0) {
      console.log('\nSample row:');
      const sample = sampleResult.recordset[0];
      Object.keys(sample).forEach(key => {
        console.log(`  ${key}: ${sample[key]}`);
      });
    }
    
    // Check for revenue-related columns
    console.log('\n' + '='.repeat(60));
    console.log('Potential Revenue Columns');
    console.log('='.repeat(60));
    
    const revenueColumns = schemaResult.recordset.filter(col => 
      col.COLUMN_NAME.toLowerCase().includes('total') ||
      col.COLUMN_NAME.toLowerCase().includes('price') ||
      col.COLUMN_NAME.toLowerCase().includes('amount') ||
      col.COLUMN_NAME.toLowerCase().includes('value')
    );
    
    if (revenueColumns.length > 0) {
      console.log('\nFound potential revenue columns:');
      revenueColumns.forEach(col => {
        console.log(`  - ${col.COLUMN_NAME} (${col.DATA_TYPE})`);
      });
    } else {
      console.log('\nNo obvious revenue columns found. Full column list above.');
    }
    
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  } finally {
    if (pool) await pool.close();
  }
}

main().then(() => {
  console.log('\nInspection complete.');
  process.exit(0);
}).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
