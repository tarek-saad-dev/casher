/**
 * Complete Employee Advances Setup Script
 * This script will:
 * 1. Update CHECK constraint to allow 'revenue' TxnKind
 * 2. Add advance mappings
 * 3. Find and add revenue category mappings
 * 4. Verify everything works
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
    console.log('='.repeat(70));
    console.log('Employee Advances Complete Setup');
    console.log('='.repeat(70));
    console.log('');
    
    pool = await sql.connect(config);
    console.log('✓ Connected to database\n');
    
    // =============================================
    // STEP 1: Update CHECK Constraint
    // =============================================
    console.log('STEP 1: Updating CHECK constraint...');
    console.log('-'.repeat(70));
    
    try {
      await pool.request().query(`
        ALTER TABLE [dbo].[TblExpCatEmpMap]
        DROP CONSTRAINT [CHK_ExpCatEmpMap_TxnKind];
      `);
      console.log('✓ Dropped old constraint');
    } catch (err) {
      console.log('⚠ Constraint may not exist yet (this is OK)');
    }
    
    await pool.request().query(`
      ALTER TABLE [dbo].[TblExpCatEmpMap]
      ADD CONSTRAINT [CHK_ExpCatEmpMap_TxnKind] 
      CHECK ([TxnKind] IN (N'advance', N'deduction', N'revenue'));
    `);
    console.log('✓ Added new constraint allowing advance, deduction, and revenue\n');
    
    // =============================================
    // STEP 2: Add Advance Mappings
    // =============================================
    console.log('STEP 2: Adding advance mappings...');
    console.log('-'.repeat(70));
    
    const advanceMappings = [
      { ExpINID: 52, EmpID: 19, CatName: 'سلف باسم' },
      { ExpINID: 8, EmpID: 5, CatName: 'سلفة(كريم)' },
      { ExpINID: 34, EmpID: 7, CatName: 'سلفه ( محمد )' },
      { ExpINID: 39, EmpID: 7, CatName: 'سلف ( أستاذ محمد )' },
      { ExpINID: 12, EmpID: 7, CatName: 'سلفة(محمد الدمياطي)' },
      { ExpINID: 33, EmpID: 12, CatName: 'سلفه ( ذياد )' },
      { ExpINID: 35, EmpID: 16, CatName: 'سلفة ( ذياد المساعد )' },
    ];
    
    let advanceCount = 0;
    for (const mapping of advanceMappings) {
      const result = await pool.request()
        .input('ExpINID', sql.Int, mapping.ExpINID)
        .input('EmpID', sql.Int, mapping.EmpID)
        .input('Notes', sql.NVarChar, mapping.CatName)
        .query(`
          INSERT INTO [dbo].[TblExpCatEmpMap] ([ExpINID], [EmpID], [TxnKind], [Notes])
          SELECT @ExpINID, @EmpID, N'advance', @Notes
          WHERE NOT EXISTS (
              SELECT 1 FROM [dbo].[TblExpCatEmpMap]
              WHERE [ExpINID] = @ExpINID
                AND [EmpID] = @EmpID
                AND [TxnKind] = N'advance'
          );
        `);
      
      if (result.rowsAffected[0] > 0) {
        console.log(`  ✓ Added: ${mapping.CatName}`);
        advanceCount++;
      } else {
        console.log(`  - Already exists: ${mapping.CatName}`);
      }
    }
    console.log(`\n✓ Added ${advanceCount} new advance mappings\n`);
    
    // =============================================
    // STEP 3: Find Revenue Categories
    // =============================================
    console.log('STEP 3: Finding revenue categories...');
    console.log('-'.repeat(70));
    
    const revenueCatsResult = await pool.request().query(`
      SELECT ExpINID, CatName, ExpINType
      FROM [dbo].[TblExpINCat]
      WHERE ExpINType = N'ايرادات'
      ORDER BY CatName
    `);
    
    console.log(`Found ${revenueCatsResult.recordset.length} revenue categories:\n`);
    
    if (revenueCatsResult.recordset.length > 0) {
      revenueCatsResult.recordset.forEach(cat => {
        console.log(`  ExpINID: ${cat.ExpINID} | "${cat.CatName}"`);
      });
    } else {
      console.log('  No revenue categories found in TblExpINCat');
    }
    console.log('');
    
    // =============================================
    // STEP 4: Add Revenue Mappings (if categories exist)
    // =============================================
    console.log('STEP 4: Adding revenue mappings...');
    console.log('-'.repeat(70));
    
    // Map revenue categories to employees based on name patterns
    const employeeNames = {
      5: ['كريم', 'karim'],
      7: ['محمد', 'mohammed', 'mohamed'],
      12: ['ذياد', 'ziad'],
      16: ['ذياد المساعد'],
      19: ['باسم', 'basem'],
    };
    
    let revenueCount = 0;
    for (const cat of revenueCatsResult.recordset) {
      const catNameLower = cat.CatName.toLowerCase();
      
      // Try to match category name to employee
      let matchedEmpID = null;
      for (const [empID, names] of Object.entries(employeeNames)) {
        if (names.some(name => catNameLower.includes(name.toLowerCase()))) {
          matchedEmpID = parseInt(empID);
          break;
        }
      }
      
      if (matchedEmpID) {
        const result = await pool.request()
          .input('ExpINID', sql.Int, cat.ExpINID)
          .input('EmpID', sql.Int, matchedEmpID)
          .input('Notes', sql.NVarChar, cat.CatName)
          .query(`
            INSERT INTO [dbo].[TblExpCatEmpMap] ([ExpINID], [EmpID], [TxnKind], [Notes])
            SELECT @ExpINID, @EmpID, N'revenue', @Notes
            WHERE NOT EXISTS (
                SELECT 1 FROM [dbo].[TblExpCatEmpMap]
                WHERE [ExpINID] = @ExpINID
                  AND [EmpID] = @EmpID
                  AND [TxnKind] = N'revenue'
            );
          `);
        
        if (result.rowsAffected[0] > 0) {
          console.log(`  ✓ Added: ${cat.CatName} → EmpID ${matchedEmpID}`);
          revenueCount++;
        } else {
          console.log(`  - Already exists: ${cat.CatName}`);
        }
      } else {
        console.log(`  ⚠ No employee match for: ${cat.CatName}`);
      }
    }
    console.log(`\n✓ Added ${revenueCount} new revenue mappings\n`);
    
    // =============================================
    // STEP 5: Verify Mappings
    // =============================================
    console.log('STEP 5: Verifying all mappings...');
    console.log('-'.repeat(70));
    
    const verifyResult = await pool.request().query(`
      SELECT 
        m.ID,
        m.ExpINID,
        c.CatName,
        c.ExpINType,
        m.EmpID,
        e.EmpName,
        m.TxnKind,
        m.IsActive
      FROM [dbo].[TblExpCatEmpMap] m
      INNER JOIN [dbo].[TblExpINCat] c ON m.ExpINID = c.ExpINID
      INNER JOIN [dbo].[TblEmp] e ON m.EmpID = e.EmpID
      WHERE m.IsActive = 1
      ORDER BY m.TxnKind, e.EmpName, c.CatName
    `);
    
    console.log(`\nTotal active mappings: ${verifyResult.recordset.length}\n`);
    
    const advances = verifyResult.recordset.filter(r => r.TxnKind === 'advance');
    const revenues = verifyResult.recordset.filter(r => r.TxnKind === 'revenue');
    
    console.log(`Advances (${advances.length}):`);
    advances.forEach(r => {
      console.log(`  ${r.EmpName.padEnd(20)} ← ${r.CatName}`);
    });
    
    console.log(`\nRevenues (${revenues.length}):`);
    if (revenues.length > 0) {
      revenues.forEach(r => {
        console.log(`  ${r.EmpName.padEnd(20)} ← ${r.CatName}`);
      });
    } else {
      console.log('  (none - will show zero revenue in UI until you add revenue transactions)');
    }
    
    // =============================================
    // STEP 6: Test API Query
    // =============================================
    console.log('\n' + '='.repeat(70));
    console.log('STEP 6: Testing API queries...');
    console.log('-'.repeat(70));
    
    const testYear = 2026;
    const testMonth = 3;
    
    // Test advances query
    const testAdvances = await pool.request()
      .input('year', sql.Int, testYear)
      .input('month', sql.Int, testMonth)
      .query(`
        SELECT 
          em.EmpID,
          e.EmpName,
          SUM(cm.GrandTolal) AS TotalAdvances,
          COUNT(cm.ID) AS AdvanceCount,
          MAX(cm.invDate) AS LatestAdvanceDate
        FROM [dbo].[TblExpCatEmpMap] em
        INNER JOIN [dbo].[TblCashMove] cm ON em.ExpINID = cm.ExpINID
        INNER JOIN [dbo].[TblEmp] e ON em.EmpID = e.EmpID
        WHERE em.IsActive = 1
          AND em.TxnKind = N'advance'
          AND cm.invType = N'مصروفات'
          AND cm.inOut = N'out'
          AND YEAR(cm.invDate) = @year
          AND MONTH(cm.invDate) = @month
        GROUP BY em.EmpID, e.EmpName
      `);
    
    console.log(`\nAdvances found for ${testMonth}/${testYear}:`);
    if (testAdvances.recordset.length > 0) {
      testAdvances.recordset.forEach(r => {
        console.log(`  ${r.EmpName}: ${r.TotalAdvances} ج.م (${r.AdvanceCount} transactions)`);
      });
    } else {
      console.log('  No advances found for this month');
    }
    
    // Test revenue query
    const testRevenue = await pool.request()
      .input('year', sql.Int, testYear)
      .input('month', sql.Int, testMonth)
      .query(`
        SELECT 
          em.EmpID,
          e.EmpName,
          SUM(cm.GrandTolal) AS TotalRevenue,
          COUNT(cm.ID) AS RevenueCount
        FROM [dbo].[TblExpCatEmpMap] em
        INNER JOIN [dbo].[TblExpINCat] cat ON em.ExpINID = cat.ExpINID
        INNER JOIN [dbo].[TblCashMove] cm ON cat.ExpINID = cm.ExpINID
        INNER JOIN [dbo].[TblEmp] e ON em.EmpID = e.EmpID
        WHERE em.IsActive = 1
          AND em.TxnKind = N'revenue'
          AND cat.ExpINType = N'ايرادات'
          AND YEAR(cm.invDate) = @year
          AND MONTH(cm.invDate) = @month
        GROUP BY em.EmpID, e.EmpName
      `);
    
    console.log(`\nRevenues found for ${testMonth}/${testYear}:`);
    if (testRevenue.recordset.length > 0) {
      testRevenue.recordset.forEach(r => {
        console.log(`  ${r.EmpName}: ${r.TotalRevenue} ج.م (${r.RevenueCount} transactions)`);
      });
    } else {
      console.log('  No revenues found for this month');
    }
    
    // =============================================
    // Summary
    // =============================================
    console.log('\n' + '='.repeat(70));
    console.log('SETUP COMPLETE!');
    console.log('='.repeat(70));
    console.log(`✓ CHECK constraint updated`);
    console.log(`✓ ${advanceCount} advance mappings added`);
    console.log(`✓ ${revenueCount} revenue mappings added`);
    console.log(`✓ Total active mappings: ${verifyResult.recordset.length}`);
    console.log('');
    console.log('Next steps:');
    console.log('1. Refresh your browser (F5)');
    console.log('2. Go to Monthly Expenses Report');
    console.log('3. Click "سلف الموظفين" tab');
    console.log('4. You should see employee cards with advance data');
    console.log('');
    console.log('Note: Revenue will show as 0 until you record revenue transactions');
    console.log('      in TblCashMove with categories that have ExpINType = "ايرادات"');
    
  } catch (err) {
    console.error('\n❌ ERROR:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    if (pool) await pool.close();
  }
}

main().then(() => {
  console.log('');
  process.exit(0);
}).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
