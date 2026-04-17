/**
 * Script: Generate Employee Advance Mappings
 * Purpose: Inspect real DB data and create safe TblExpCatEmpMap mappings
 * Date: 2026-03-31
 */

const sql = require('mssql');

// Database configuration - using same config as POS system
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

// Normalize Arabic text for better matching
function normalizeArabic(text) {
  if (!text) return '';
  return text
    .replace(/سلفه/g, '')
    .replace(/سلفة/g, '')
    .replace(/سلف/g, '')
    .replace(/\(/g, '')
    .replace(/\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Calculate match confidence
function calculateMatchConfidence(extractedName, employeeName) {
  const extracted = normalizeArabic(extractedName).toLowerCase();
  const employee = employeeName.toLowerCase().trim();
  
  if (extracted === employee) return { level: 'HIGH', type: 'Exact' };
  if (employee.includes(extracted)) return { level: 'MEDIUM', type: 'Contains' };
  if (extracted.includes(employee)) return { level: 'MEDIUM', type: 'Partial' };
  
  return { level: 'LOW', type: 'Weak' };
}

async function main() {
  let pool;
  
  try {
    console.log('='.repeat(60));
    console.log('Employee Advance Mapping Generator');
    console.log('='.repeat(60));
    console.log('');
    
    // Connect to database
    console.log('Connecting to database...');
    pool = await sql.connect(config);
    console.log('✓ Connected successfully\n');
    
    // =============================================
    // STEP 1: Query Expense Categories
    // =============================================
    console.log('STEP 1: Querying expense categories...');
    console.log('-'.repeat(60));
    
    const categoriesResult = await pool.request().query(`
      SELECT 
        ExpINID,
        CatName,
        ExpINType
      FROM [dbo].[TblExpINCat]
      WHERE ExpINType = N'مصروفات'
        AND (
          CatName LIKE N'%سلف%'
          OR CatName LIKE N'%سلفة%'
          OR CatName LIKE N'%سلفه%'
        )
      ORDER BY CatName
    `);
    
    const categories = categoriesResult.recordset;
    console.log(`Found ${categories.length} advance-related categories:\n`);
    
    categories.forEach(cat => {
      const extracted = normalizeArabic(cat.CatName);
      console.log(`  ExpINID: ${cat.ExpINID} | "${cat.CatName}" -> "${extracted}"`);
    });
    console.log('');
    
    // =============================================
    // STEP 2: Query Employees
    // =============================================
    console.log('STEP 2: Querying employees...');
    console.log('-'.repeat(60));
    
    const employeesResult = await pool.request().query(`
      SELECT 
        EmpID,
        EmpName,
        IsActive
      FROM [dbo].[TblEmp]
      WHERE IsActive = 1
      ORDER BY EmpName
    `);
    
    const employees = employeesResult.recordset;
    console.log(`Found ${employees.length} active employees:\n`);
    
    employees.forEach(emp => {
      console.log(`  EmpID: ${emp.EmpID} | "${emp.EmpName}"`);
    });
    console.log('');
    
    // =============================================
    // STEP 3: Match Categories to Employees
    // =============================================
    console.log('STEP 3: Matching categories to employees...');
    console.log('-'.repeat(60));
    console.log('');
    
    const autoConfirmed = [];
    const ambiguous = [];
    const noMatch = [];
    
    categories.forEach(cat => {
      const extractedName = normalizeArabic(cat.CatName);
      const matches = [];
      
      employees.forEach(emp => {
        const confidence = calculateMatchConfidence(extractedName, emp.EmpName);
        
        if (confidence.level === 'HIGH' || confidence.level === 'MEDIUM') {
          matches.push({
            employee: emp,
            confidence: confidence.level,
            matchType: confidence.type
          });
        }
      });
      
      if (matches.length === 0) {
        noMatch.push({ category: cat, extractedName });
      } else if (matches.length === 1) {
        autoConfirmed.push({
          category: cat,
          employee: matches[0].employee,
          confidence: matches[0].confidence,
          matchType: matches[0].matchType,
          extractedName
        });
      } else {
        ambiguous.push({
          category: cat,
          matches,
          extractedName
        });
      }
    });
    
    // =============================================
    // STEP 4: Display Results
    // =============================================
    console.log('='.repeat(60));
    console.log('MATCHING RESULTS');
    console.log('='.repeat(60));
    console.log('');
    
    // Auto-confirmed mappings
    console.log(`✓ AUTO-CONFIRMED MAPPINGS (${autoConfirmed.length}):`);
    console.log('-'.repeat(60));
    if (autoConfirmed.length > 0) {
      autoConfirmed.forEach(mapping => {
        console.log(`  "${mapping.category.CatName}"`);
        console.log(`    → Employee: ${mapping.employee.EmpName} (ID: ${mapping.employee.EmpID})`);
        console.log(`    → Confidence: ${mapping.confidence} (${mapping.matchType})`);
        console.log(`    → ExpINID: ${mapping.category.ExpINID}`);
        console.log('');
      });
    } else {
      console.log('  (none)');
    }
    console.log('');
    
    // Ambiguous mappings
    console.log(`⚠ AMBIGUOUS MAPPINGS - NEED MANUAL REVIEW (${ambiguous.length}):`);
    console.log('-'.repeat(60));
    if (ambiguous.length > 0) {
      ambiguous.forEach(item => {
        console.log(`  "${item.category.CatName}" (ExpINID: ${item.category.ExpINID})`);
        console.log(`    Extracted: "${item.extractedName}"`);
        console.log(`    Possible matches:`);
        item.matches.forEach(match => {
          console.log(`      - ${match.employee.EmpName} (ID: ${match.employee.EmpID}) [${match.confidence}]`);
        });
        console.log('');
      });
    } else {
      console.log('  (none)');
    }
    console.log('');
    
    // No matches
    console.log(`✗ NO MATCHES FOUND (${noMatch.length}):`);
    console.log('-'.repeat(60));
    if (noMatch.length > 0) {
      noMatch.forEach(item => {
        console.log(`  "${item.category.CatName}" (ExpINID: ${item.category.ExpINID})`);
        console.log(`    Extracted: "${item.extractedName}"`);
        console.log('');
      });
    } else {
      console.log('  (none)');
    }
    console.log('');
    
    // =============================================
    // STEP 5: Generate SQL Script
    // =============================================
    console.log('='.repeat(60));
    console.log('GENERATED SQL SCRIPT');
    console.log('='.repeat(60));
    console.log('');
    
    if (autoConfirmed.length === 0) {
      console.log('-- No auto-confirmed mappings to insert.');
      console.log('-- Please review ambiguous matches and create mappings manually.');
    } else {
      console.log('-- Safe INSERT script using real IDs from live database');
      console.log('-- This script checks for existing mappings to prevent duplicates');
      console.log('');
      console.log('BEGIN TRANSACTION;');
      console.log('');
      
      autoConfirmed.forEach(mapping => {
        console.log(`-- Mapping: "${mapping.category.CatName}" → ${mapping.employee.EmpName}`);
        console.log(`INSERT INTO [dbo].[TblExpCatEmpMap] ([ExpINID], [EmpID], [TxnKind], [Notes])`);
        console.log(`SELECT ${mapping.category.ExpINID}, ${mapping.employee.EmpID}, N'advance', N'${mapping.category.CatName.replace(/'/g, "''")}'`);
        console.log(`WHERE NOT EXISTS (`);
        console.log(`    SELECT 1 FROM [dbo].[TblExpCatEmpMap]`);
        console.log(`    WHERE [ExpINID] = ${mapping.category.ExpINID}`);
        console.log(`      AND [EmpID] = ${mapping.employee.EmpID}`);
        console.log(`      AND [TxnKind] = N'advance'`);
        console.log(`);`);
        console.log('');
      });
      
      console.log('-- Verify the inserts');
      console.log('SELECT * FROM [dbo].[TblExpCatEmpMap];');
      console.log('');
      console.log('-- If everything looks correct, commit the transaction');
      console.log('COMMIT TRANSACTION;');
      console.log('');
      console.log('-- If there are issues, rollback instead');
      console.log('-- ROLLBACK TRANSACTION;');
    }
    
    console.log('');
    console.log('='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total categories found: ${categories.length}`);
    console.log(`Auto-confirmed mappings: ${autoConfirmed.length}`);
    console.log(`Ambiguous mappings: ${ambiguous.length}`);
    console.log(`No matches: ${noMatch.length}`);
    console.log('');
    
    if (ambiguous.length > 0) {
      console.log('⚠ WARNING: There are ambiguous mappings that need manual review.');
      console.log('Please review the ambiguous section above and create those mappings manually.');
    }
    
    if (autoConfirmed.length > 0) {
      console.log('');
      console.log('✓ NEXT STEPS:');
      console.log('1. Review the auto-confirmed mappings above');
      console.log('2. Copy the generated SQL script');
      console.log('3. Run it in SQL Server Management Studio');
      console.log('4. Verify the results');
      console.log('5. Handle ambiguous cases manually if needed');
    }
    
  } catch (err) {
    console.error('ERROR:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.close();
    }
  }
}

// Run the script
main().then(() => {
  console.log('');
  console.log('Script completed successfully.');
  process.exit(0);
}).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
