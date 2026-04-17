# FIX APPLIED: TblCashMove Duplicate Insertion

**Date**: 2026-04-06  
**File Modified**: `src/app/api/sales/route.ts`  
**Root Cause**: Double insertion - Application + Database Trigger

---

## CHANGES APPLIED

### 1. ✅ Removed Duplicate TblCashMove INSERT (Lines 198-201)

**BEFORE (Lines 198-219)**:
```typescript
// ──── 5. Insert TblCashMove (matches legacy pattern) ────
const cashReq = new sql.Request(transaction);
cashReq
  .input('invID',           sql.Int,            newInvID)
  .input('invType',         sql.NVarChar(20),   invType)
  .input('invDate',         sql.Date,           invDate)
  .input('invTime',         sql.NVarChar(50),   invTime)
  .input('ClientID',        sql.Int,            body.clientId || null)
  .input('GrandTolal',      sql.Decimal(10,2),  grandTotal)
  .input('inOut',           sql.NVarChar(5),    'in')
  .input('Notes',           sql.NVarChar(sql.MAX), notesText)
  .input('ShiftMoveID',     sql.Int,            shiftMoveID)
  .input('PaymentMethodID', sql.Int,            body.paymentMethodId);

await cashReq.query(`
  INSERT INTO [dbo].[TblCashMove] (
    invID, invType, invDate, invTime, ClientID, GrandTolal, inOut, Notes, ShiftMoveID, PaymentMethodID
  ) VALUES (
    @invID, @invType, @invDate, @invTime, @ClientID, @GrandTolal, @inOut, @Notes, @ShiftMoveID, @PaymentMethodID
  )
`);
console.log(`[pos-api]   ✅ TblCashMove inserted: GrandTolal=${grandTotal}, inOut=in, ShiftMoveID=${shiftMoveID}`);
```

**AFTER (Lines 198-201)**:
```typescript
// ──── 5. TblCashMove insertion handled by trigger [InsCashMoveSales] ────
// REMOVED: Duplicate INSERT removed to prevent double entries
// Trigger InsCashMoveSales on TblinvServHead will automatically insert into TblCashMove
console.log(`[pos-api]   ℹ️  TblCashMove will be inserted by trigger InsCashMoveSales`);
```

**Reason**: Database trigger `InsCashMoveSales` already handles TblCashMove insertion when TblinvServHead is inserted.

---

### 2. ✅ Fixed isActive Bug (Line 115)

**BEFORE**:
```typescript
.input('isActive', sql.NVarChar(5), 'yes')  // ❌ WRONG - marks invoices as deleted
```

**AFTER**:
```typescript
.input('isActive', sql.NVarChar(5), 'no')   // ✅ CORRECT - marks invoices as active
```

**Reason**: 
- Active invoices have `isActive = 'no'` or `NULL`
- Deleted invoices have `isActive = 'yes'`
- Previous code marked all new sales as deleted, making them invisible in reports

---

## DATABASE TRIGGER CONFIRMED

### Trigger: `InsCashMoveSales`
**Parent Table**: `TblinvServHead`  
**Timing**: AFTER INSERT  
**Action**: Inserts into `TblCashMove` based on `invType`

**Logic**:
```sql
-- For invType = N'مبيعات' (Sales)
INSERT INTO TblCashMove(
  invID, invType, invDate, invTime, ClientID, 
  GrandTolal, inOut, Notes, ShiftMoveID, PaymentMethodID
)
VALUES(
  @invid, @invType, @invDate, @invTime, @clientID,
  @value, 'in', @note, @shiftmoveID, @PaymentMethodID
)
```

**Also handles**:
- `N'مبيعات بالكارت'` (Card Sales) → inOut = 'out'
- `N'م.مبيعات'` (Sales Return) → inOut = 'out'
- `N'م.مبيعات بالكارت'` (Card Sales Return) → inOut = 'in'

---

## SAVE SALE FLOW (Updated)

### Transaction Sequence:

```
BEGIN TRANSACTION (SERIALIZABLE)
  ↓
1. Generate invID with TABLOCKX
   SELECT MAX(invID) + 1 FROM TblinvServHead
  ↓
2. INSERT into TblinvServHead
   ↓
   [TRIGGER fires] → InsCashMoveSales
   ↓
   → INSERT into TblCashMove (automatically)
  ↓
3. INSERT into TblinvServDetail (N rows)
  ↓
4. INSERT into TblinvServPayment
  ↓
5. [REMOVED] Application INSERT into TblCashMove
  ↓
6. COMMIT
```

**Result**: TblCashMove has exactly **1 row** per invoice (inserted by trigger).

---

## IMPACT ANALYSIS

### Before Fix:
- ❌ TblCashMove: 2 rows per invoice (application + trigger)
- ❌ Reports: Doubled cash movements
- ❌ Shift reconciliation: Incorrect totals
- ❌ New invoices invisible (isActive = 'yes')

### After Fix:
- ✅ TblCashMove: 1 row per invoice (trigger only)
- ✅ Reports: Correct cash movements
- ✅ Shift reconciliation: Accurate totals
- ✅ New invoices visible (isActive = 'no')

---

## TESTING CHECKLIST

### Test 1: Create New Sale
1. Open POS system
2. Create a new sale with:
   - Customer
   - Service(s)
   - Payment method
3. **Verify in DB**:
   ```sql
   -- Check TblinvServHead
   SELECT TOP 1 * FROM TblinvServHead 
   ORDER BY invID DESC;
   
   -- Check TblCashMove (should be exactly 1 row)
   SELECT * FROM TblCashMove 
   WHERE invID = (SELECT MAX(invID) FROM TblinvServHead WHERE invType = N'مبيعات');
   
   -- Verify isActive
   SELECT invID, isActive FROM TblinvServHead 
   WHERE invID = (SELECT MAX(invID) FROM TblinvServHead WHERE invType = N'مبيعات');
   -- Expected: isActive = 'no'
   ```

### Test 2: Verify Reports
1. Navigate to `/sales/today`
2. Select today's date
3. **Expected**:
   - New sale appears in transactions
   - KPI shows correct totals
   - Payment breakdown includes new sale
   - Shift analysis includes new sale

### Test 3: Shift Reconciliation
1. Close current shift
2. View shift summary
3. **Expected**:
   - Cash movements match actual sales
   - No duplicate entries
   - Correct payment method totals

---

## CONSOLE LOGS (Expected)

### Before (Duplicate):
```
[pos-api]   ✅ TblinvServHead inserted: invID=1234
[pos-api]   ✅ TblinvServDetail inserted: 2 row(s)
[pos-api]   ✅ TblinvServPayment inserted: PayValue=150.00
[pos-api]   ✅ TblCashMove inserted: GrandTolal=150.00  ← Application INSERT
[pos-api]   ✅ COMMITTED
```

### After (Single):
```
[pos-api]   ✅ TblinvServHead inserted: invID=1234
[pos-api]   ✅ TblinvServDetail inserted: 2 row(s)
[pos-api]   ✅ TblinvServPayment inserted: PayValue=150.00
[pos-api]   ℹ️  TblCashMove will be inserted by trigger InsCashMoveSales  ← Trigger handles it
[pos-api]   ✅ COMMITTED
```

---

## WHY TRIGGER INSTEAD OF APPLICATION?

**User Requirement**: 
> "فيه clientSide تانى بيستعمل نفس الداتا بيز ف عشان ميحصلش مشاكل"

**Translation**: Other client applications use the same database, so trigger ensures consistency.

**Benefits**:
1. ✅ Centralized logic - all applications benefit
2. ✅ No code duplication across clients
3. ✅ Database enforces business rules
4. ✅ Legacy compatibility maintained

---

## ROLLBACK (If Needed)

If issues arise, restore the application INSERT:

```typescript
// Add back after line 196:

// ──── 5. Insert TblCashMove ────
const cashReq = new sql.Request(transaction);
cashReq
  .input('invID',           sql.Int,            newInvID)
  .input('invType',         sql.NVarChar(20),   invType)
  .input('invDate',         sql.Date,           invDate)
  .input('invTime',         sql.NVarChar(50),   invTime)
  .input('ClientID',        sql.Int,            body.clientId || null)
  .input('GrandTolal',      sql.Decimal(10,2),  grandTotal)
  .input('inOut',           sql.NVarChar(5),    'in')
  .input('Notes',           sql.NVarChar(sql.MAX), notesText)
  .input('ShiftMoveID',     sql.Int,            shiftMoveID)
  .input('PaymentMethodID', sql.Int,            body.paymentMethodId);

await cashReq.query(`
  INSERT INTO [dbo].[TblCashMove] (
    invID, invType, invDate, invTime, ClientID, GrandTolal, inOut, Notes, ShiftMoveID, PaymentMethodID
  ) VALUES (
    @invID, @invType, @invDate, @invTime, @ClientID, @GrandTolal, @inOut, @Notes, @ShiftMoveID, @PaymentMethodID
  )
`);
console.log(`[pos-api]   ✅ TblCashMove inserted: GrandTolal=${grandTotal}`);

// And DISABLE the trigger:
-- DISABLE TRIGGER dbo.InsCashMoveSales ON dbo.TblinvServHead;
```

**Note**: Only rollback if trigger is confirmed disabled/broken.

---

## FILES MODIFIED

| File | Lines Changed | Description |
|------|---------------|-------------|
| `src/app/api/sales/route.ts` | 115 | Fixed isActive value |
| `src/app/api/sales/route.ts` | 198-201 | Removed duplicate TblCashMove INSERT |

**Total lines removed**: 22  
**Total lines added**: 4  
**Net reduction**: 18 lines

---

## SUMMARY

### Root Cause:
- Application code + Database trigger both inserted into TblCashMove
- Result: 2 rows per invoice

### Fix:
- Removed application INSERT (lines 198-219)
- Fixed isActive bug (line 115)
- Trigger handles TblCashMove insertion

### Impact:
- ✅ No more duplicates
- ✅ Reports show correct data
- ✅ New invoices visible (isActive = 'no')
- ✅ Compatible with other client applications

---

**FIX STATUS**: ✅ COMPLETE  
**TESTING STATUS**: ⏳ PENDING USER VERIFICATION
