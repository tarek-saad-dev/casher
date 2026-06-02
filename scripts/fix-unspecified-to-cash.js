/**
 * Script to fix all unspecified payment methods to Cash (كاش)
 * Run: node scripts/fix-unspecified-to-cash.js
 */

const { getPool, sql } = require('../dist/lib/db');

async function fixAllToCash() {
  console.log('🔧 Starting fix for unspecified payment methods...\n');
  
  try {
    const db = await getPool();
    
    // Step 1: Find Cash payment method ID
    console.log('Step 1: Finding Cash payment method...');
    const pmResult = await db.request()
      .query(`SELECT PaymentID FROM dbo.TblPaymentMethods WHERE PaymentMethod = N'كاش'`);
    
    if (pmResult.recordset.length === 0) {
      console.error('❌ Error: Cash payment method (كاش) not found!');
      process.exit(1);
    }
    
    const cashPaymentMethodId = pmResult.recordset[0].PaymentID;
    console.log(`✓ Found Cash payment method ID: ${cashPaymentMethodId}\n`);
    
    // Step 2: Count affected transactions
    console.log('Step 2: Counting affected transactions...');
    const countResult = await db.request().query(`
      SELECT 
        COUNT(*) AS totalCount,
        SUM(CASE WHEN CM.invType = N'ايرادات' THEN 1 ELSE 0 END) AS revenueCount,
        SUM(CASE WHEN CM.invType = N'مصروفات' THEN 1 ELSE 0 END) AS expenseCount,
        SUM(CM.GrandTolal) AS totalAmount
      FROM dbo.TblCashMove CM
      LEFT JOIN dbo.TblPaymentMethods PM ON CM.PaymentMethodID = PM.PaymentID
      WHERE CM.PaymentMethodID IS NULL 
         OR PM.PaymentMethod IS NULL 
         OR PM.PaymentMethod = '' 
         OR PM.PaymentMethod = N'غير محدد'
    `);
    
    const stats = countResult.recordset[0];
    console.log(`✓ Found ${stats.totalCount} transactions to fix:`);
    console.log(`  - Revenue (ايرادات): ${stats.revenueCount}`);
    console.log(`  - Expense (مصروفات): ${stats.expenseCount}`);
    console.log(`  - Total Amount: ${stats.totalAmount?.toLocaleString() || 0} EGP\n`);
    
    if (stats.totalCount === 0) {
      console.log('✅ No transactions to fix. Exiting.');
      process.exit(0);
    }
    
    // Step 3: Get transactions to update
    console.log('Step 3: Fetching transaction IDs...');
    const txResult = await db.request().query(`
      SELECT 
        CM.ID,
        CM.PaymentMethodID,
        CM.invType,
        CM.GrandTolal,
        CM.invDate,
        CM.Notes
      FROM dbo.TblCashMove CM
      LEFT JOIN dbo.TblPaymentMethods PM ON CM.PaymentMethodID = PM.PaymentID
      WHERE CM.PaymentMethodID IS NULL 
         OR PM.PaymentMethod IS NULL 
         OR PM.PaymentMethod = '' 
         OR PM.PaymentMethod = N'غير محدد'
      ORDER BY CM.invDate DESC
    `);
    
    const transactions = txResult.recordset;
    console.log(`✓ Fetched ${transactions.length} transactions\n`);
    
    // Step 4: Update transactions
    console.log('Step 4: Updating transactions to Cash...\n');
    
    const transaction = new sql.Transaction(db);
    await transaction.begin();
    
    let updated = 0;
    let errors = [];
    
    for (const tx of transactions) {
      try {
        // Build edit history entry
        const editEntry = {
          editedAt: new Date().toISOString(),
          editedBy: 'system-script',
          action: 'AUTO_FIX_TO_CASH',
          reason: 'تحويل طريقة الدفع غير المحددة إلى كاش',
          changes: {
            paymentMethodId: { old: tx.PaymentMethodID, new: cashPaymentMethodId },
            paymentMethodName: { old: 'غير محدد', new: 'كاش' }
          }
        };
        
        // Parse existing history from Notes
        let editHistory = [];
        if (tx.Notes && tx.Notes.includes('EditHistory')) {
          try {
            const match = tx.Notes.match(/EditHistory:\s*(\[.*\])/);
            if (match) {
              editHistory = JSON.parse(match[1]);
            }
          } catch { /* ignore parse errors */ }
        }
        
        editHistory.push(editEntry);
        
        // Prepare new notes with edit history
        const baseNotes = tx.Notes?.replace(/\s*\[?EditHistory:.*\]?\s*$/, '').trim() || '';
        const newNotes = baseNotes 
          ? `${baseNotes} [EditHistory: ${JSON.stringify(editHistory)}]`
          : `[EditHistory: ${JSON.stringify(editHistory)}]`;
        
        // Update the transaction
        await new sql.Request(transaction)
          .input('id', sql.Int, tx.ID)
          .input('paymentMethodId', sql.Int, cashPaymentMethodId)
          .input('notes', sql.NVarChar(sql.MAX), newNotes)
          .query(`
            UPDATE dbo.TblCashMove
            SET 
              PaymentMethodID = @paymentMethodId,
              Notes = @notes
            WHERE ID = @id
          `);
        
        updated++;
        
        // Log progress every 100 records
        if (updated % 100 === 0) {
          console.log(`  Progress: ${updated}/${transactions.length} updated...`);
        }
        
      } catch (innerErr) {
        errors.push({ 
          id: tx.ID, 
          error: innerErr.message 
        });
      }
    }
    
    await transaction.commit();
    
    console.log(`\n✅ DONE!`);
    console.log(`   Updated: ${updated} transactions`);
    console.log(`   Errors: ${errors.length}`);
    
    if (errors.length > 0) {
      console.log('\n⚠️  Errors encountered:');
      errors.slice(0, 10).forEach(e => console.log(`     - ID ${e.id}: ${e.error}`));
      if (errors.length > 10) {
        console.log(`     ... and ${errors.length - 10} more`);
      }
    }
    
    console.log('\n🎉 All unspecified payment methods have been fixed to Cash (كاش)!');
    process.exit(0);
    
  } catch (err) {
    console.error('❌ Fatal error:', err.message);
    process.exit(1);
  }
}

// Run the script
fixAllToCash();
