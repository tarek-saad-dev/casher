/**
 * Script: Inspect Revenue Structure in TblCashMove
 * Purpose: Understand how employee revenues are recorded
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
    
    // Check revenue entries in TblCashMove
    console.log('='.repeat(60));
    console.log('Revenue Entries (إيرادات IN) in TblCashMove');
    console.log('='.repeat(60));
    
    const revenueResult = await pool.request().query(`
      SELECT TOP 10
        ID,
        invID,
        invType,
        invDate,
        ExpINID,
        GrandTolal,
        inOut,
        Notes
      FROM [dbo].[TblCashMove]
      WHERE invType = N'إيرادات'
        AND inOut = N'in'
      ORDER BY invDate DESC
    `);
    
    console.log(`\nFound ${revenueResult.recordset.length} revenue entries (showing top 10):\n`);
    
    if (revenueResult.recordset.length > 0) {
      revenueResult.recordset.forEach(row => {
        console.log(`ID: ${row.ID}`);
        console.log(`  invID: ${row.invID}`);
        console.log(`  invType: ${row.invType}`);
        console.log(`  invDate: ${row.invDate}`);
        console.log(`  ExpINID: ${row.ExpINID}`);
        console.log(`  GrandTolal: ${row.GrandTolal}`);
        console.log(`  inOut: ${row.inOut}`);
        console.log(`  Notes: ${row.Notes || '(empty)'}`);
        console.log('');
      });
    } else {
      console.log('  No revenue entries found.');
    }
    
    // Check if there are revenue categories linked to employees
    console.log('='.repeat(60));
    console.log('Revenue Categories in TblExpINCat');
    console.log('='.repeat(60));
    
    const revenueCatsResult = await pool.request().query(`
      SELECT 
        ExpINID,
        CatName,
        ExpINType
      FROM [dbo].[TblExpINCat]
      WHERE ExpINType = N'إيرادات'
      ORDER BY CatName
    `);
    
    console.log(`\nFound ${revenueCatsResult.recordset.length} revenue categories:\n`);
    
    if (revenueCatsResult.recordset.length > 0) {
      revenueCatsResult.recordset.forEach(cat => {
        console.log(`  ExpINID: ${cat.ExpINID} | "${cat.CatName}"`);
      });
    }
    
    // Check for potential employee-linked revenue categories
    console.log('\n' + '='.repeat(60));
    console.log('Potential Employee Revenue Categories');
    console.log('='.repeat(60));
    
    const empRevenueCats = revenueCatsResult.recordset.filter(cat => 
      cat.CatName.includes('موظف') ||
      cat.CatName.includes('محمد') ||
      cat.CatName.includes('كريم') ||
      cat.CatName.includes('باسم') ||
      cat.CatName.includes('ذياد') ||
      cat.CatName.includes('هدى')
    );
    
    if (empRevenueCats.length > 0) {
      console.log(`\nFound ${empRevenueCats.length} employee-related revenue categories:\n`);
      empRevenueCats.forEach(cat => {
        console.log(`  ExpINID: ${cat.ExpINID} | "${cat.CatName}"`);
      });
    } else {
      console.log('\nNo obvious employee-related revenue categories found.');
      console.log('You may need to create mappings for revenue categories similar to advances.');
    }
    
    // Sample query for employee revenue calculation
    console.log('\n' + '='.repeat(60));
    console.log('Sample Employee Revenue Query');
    console.log('='.repeat(60));
    console.log(`
This is how employee revenue would be calculated from TblCashMove:

SELECT 
  em.EmpID,
  e.EmpName,
  SUM(cm.GrandTolal) AS TotalRevenue,
  COUNT(cm.ID) AS RevenueCount
FROM TblExpCatEmpMap em
INNER JOIN TblCashMove cm ON em.ExpINID = cm.ExpINID
INNER JOIN TblEmp e ON em.EmpID = e.EmpID
WHERE em.IsActive = 1
  AND em.TxnKind = N'revenue'  -- New transaction kind
  AND cm.invType = N'إيرادات'
  AND cm.inOut = N'in'
  AND YEAR(cm.invDate) = @year
  AND MONTH(cm.invDate) = @month
GROUP BY em.EmpID, e.EmpName

NOTE: You'll need to:
1. Add revenue category mappings to TblExpCatEmpMap with TxnKind = 'revenue'
2. Update the CHECK constraint to allow 'revenue' as a valid TxnKind
    `);
    
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
