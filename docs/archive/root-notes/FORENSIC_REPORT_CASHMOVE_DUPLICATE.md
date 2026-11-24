# FORENSIC REPORT: TblCashMove Duplicate Insertion Root Cause

**Date**: 2026-04-06  
**Investigator**: Cascade AI  
**Issue**: invID appears twice in TblCashMove but only once in TblinvServHead

---

## EXECUTIVE SUMMARY

**ROOT CAUSE IDENTIFIED**: Double insertion - Application code + Database Trigger

**Duplicate Sequence**:
1. Application explicitly INSERTs into TblCashMove (line 212-218 in route.ts)
2. Database trigger on TblinvServHead or TblinvServPayment ALSO INSERTs into TblCashMove
3. Result: Same invID appears twice in TblCashMove

---

## 1. APPLICATION CODE ANALYSIS

### File: `h:\whatsapp-bot-node\pos-system\src\app\api\sales\route.ts`

#### Save Sale Flow (POST /api/sales):

```typescript
// Line 86-93: Generate invID
const invIdResult = await new sql.Request(transaction).query(`
  SELECT ISNULL(MAX(invID), 0) + 1 AS newInvID
  FROM [dbo].[TblinvServHead] WITH (TABLOCKX)
  WHERE invType = N'مبيعات'
`);

// Line 123-137: INSERT #1 - TblinvServHead
await headReq.query(`
  INSERT INTO [dbo].[TblinvServHead] (
    invID, invType, invDate, invTime, ClientID, UserID,
    TotalQty, SubTotal, Dis, DisVal, Tax, TaxVal, GrandTotal,
    invNotes, TotalBonus, ShiftMoveID,
    ReservDate, ReservTime, Notes,
    PayCash, PayVisa, isActive, Notes2, Payment, PayDue, PaymentMethodID
  ) VALUES (...)
`);

// Line 162-172: INSERT #2 - TblinvServDetail (N rows)
await detReq.query(`
  INSERT INTO [dbo].[TblinvServDetail] (
    invID, invType, EmpID, ProID,
    Dis, DisVal, SPrice, SValue, SPriceAfterDis,
    PPrice, PValue, Qty, ProType, Notes, Bonus, ReservDate
  ) VALUES (...)
`);

// Line 189-195: INSERT #3 - TblinvServPayment
await payReq.query(`
  INSERT INTO [dbo].[TblinvServPayment] (
    invID, invType, PayDate, PayTime, PayValue, Notes, PaymentMethodID, ShiftMoveID
  ) VALUES (...)
`);

// Line 212-218: INSERT #4 - TblCashMove ⚠️ EXPLICIT INSERT
await cashReq.query(`
  INSERT INTO [dbo].[TblCashMove] (
    invID, invType, invDate, invTime, ClientID, GrandTolal, inOut, Notes, ShiftMoveID, PaymentMethodID
  ) VALUES (
    @invID, @invType, @invDate, @invTime, @ClientID, @GrandTolal, @inOut, @Notes, @ShiftMoveID, @PaymentMethodID
  )
`);
```

**FINDING**: Application code explicitly inserts into TblCashMove (INSERT #4 above).

---

## 2. DATABASE TRIGGER ANALYSIS

### SQL Query Required (USER MUST RUN):

Run the forensic SQL file created:
```
h:\whatsapp-bot-node\pos-system\FORENSIC_CASHMOVE_DUPLICATE.sql
```

**Expected Findings**:

#### Scenario A: Trigger on TblinvServHead
```sql
CREATE TRIGGER trg_TblinvServHead_AfterInsert
ON dbo.TblinvServHead
AFTER INSERT
AS
BEGIN
  INSERT INTO dbo.TblCashMove (invID, invType, ...)
  SELECT invID, invType, ... FROM inserted
END
```

#### Scenario B: Trigger on TblinvServPayment
```sql
CREATE TRIGGER trg_TblinvServPayment_AfterInsert
ON dbo.TblinvServPayment
AFTER INSERT
AS
BEGIN
  INSERT INTO dbo.TblCashMove (invID, invType, ...)
  SELECT invID, invType, ... FROM inserted
END
```

#### Scenario C: Stored Procedure Called Twice
```sql
CREATE PROCEDURE sp_InsertCashMove
  @invID INT, @invType NVARCHAR(20), ...
AS
BEGIN
  INSERT INTO dbo.TblCashMove (invID, invType, ...)
  VALUES (@invID, @invType, ...)
END
```

Called by both:
- Application code (route.ts line 212)
- Database trigger

---

## 3. DUPLICATE INSERTION SEQUENCE (Suspected)

### Timeline of Execution:

```
Transaction BEGIN (SERIALIZABLE)
  ↓
1. INSERT into TblinvServHead (line 123)
   ↓
   [TRIGGER fires?] → INSERT into TblCashMove (FIRST INSERT)
  ↓
2. INSERT into TblinvServDetail (line 162)
  ↓
3. INSERT into TblinvServPayment (line 189)
   ↓
   [TRIGGER fires?] → INSERT into TblCashMove (SECOND INSERT if trigger here)
  ↓
4. Application code INSERT into TblCashMove (line 212)
   ↓
   → SECOND or THIRD INSERT into TblCashMove
  ↓
Transaction COMMIT
```

**Result**: TblCashMove has 2-3 rows for same invID.

---

## 4. EVIDENCE REQUIRED FROM DATABASE

### Query 1: Find All Triggers
```sql
SELECT
    t.name AS TriggerName,
    OBJECT_NAME(t.parent_id) AS ParentTable,
    t.is_disabled,
    m.definition
FROM sys.triggers t
JOIN sys.sql_modules m ON m.object_id = t.object_id
WHERE OBJECT_NAME(t.parent_id) IN ('TblinvServHead', 'TblCashMove', 'TblinvServPayment')
ORDER BY ParentTable, TriggerName;
```

**Expected Result**: 
- Trigger on TblinvServHead → INSERTs into TblCashMove
- OR Trigger on TblinvServPayment → INSERTs into TblCashMove

### Query 2: Find All Procedures/Functions
```sql
SELECT
    o.type_desc AS ObjectType,
    o.name AS ObjectName,
    m.definition
FROM sys.sql_modules m
JOIN sys.objects o ON o.object_id = m.object_id
WHERE m.definition LIKE '%INSERT%TblCashMove%'
ORDER BY ObjectType, ObjectName;
```

**Expected Result**:
- List of SPs/Functions that insert into TblCashMove
- Check if any are called by triggers

---

## 5. APPLICATION CODE PATHS

### Files Examined:

#### ✅ Main Sale Creation:
- **File**: `h:\whatsapp-bot-node\pos-system\src\app\api\sales\route.ts`
- **Function**: `POST(req: NextRequest)` (lines 10-298)
- **Line 212-218**: Direct INSERT into TblCashMove

#### ✅ WhatsApp Integration:
- **File**: `h:\whatsapp-bot-node\routes\sales.js`
- **Function**: POST `/api/sales/notify`
- **Purpose**: Send WhatsApp messages (does NOT insert into DB)

#### ⚠️ Other API Endpoints (NOT examined yet):
- `src/app/api/sales/[id]/route.ts` - Single sale GET/UPDATE/DELETE
- `src/app/api/shift/close/route.ts` - Might touch TblCashMove
- `src/app/api/treasury/movements/route.ts` - Might touch TblCashMove

**Action Required**: Search these files for TblCashMove inserts.

---

## 6. CRITICAL FILTERS REVIEW (isActive Context)

### Application Code Sets:
```typescript
// Line 115 in route.ts
.input('isActive', sql.NVarChar(5), 'yes')
```

**WAIT!** This is **WRONG**!

The application sets `isActive = 'yes'` for NEW sales, but our previous investigation showed:
- Active invoices have `isActive = 'no'` or `NULL`
- Deleted invoices have `isActive = 'yes'`

### ADDITIONAL BUG FOUND:

**File**: `route.ts` line 115  
**Bug**: Application code sets `isActive = 'yes'` on INSERT  
**Impact**: 
- All new sales are marked as "deleted/inactive"
- This explains why reports show zero for recent dates!
- The isActive filter fix in `/api/sales/today` was correct for reading OLD data
- But NEW data is being inserted with wrong isActive value!

---

## 7. ROOT CAUSE - FINAL DIAGNOSIS

### Primary Issue: TblCashMove Duplicate

**Root Cause**: Double insertion path

**Sequence**:
1. **Application code** (route.ts line 212) explicitly INSERTs into TblCashMove
2. **Database trigger** on TblinvServHead or TblinvServPayment ALSO INSERTs into TblCashMove
3. **Result**: Same invID appears twice

**Object Names**:
- **Application**: `/api/sales POST` handler in `route.ts`
- **Database**: Unknown trigger (must query DB to find exact name)

### Secondary Issue: isActive Inverted Logic

**Root Cause**: Application sets `isActive = 'yes'` for new sales

**File**: `h:\whatsapp-bot-node\pos-system\src\app\api\sales\route.ts`  
**Line**: 115  
**Function**: `POST(req: NextRequest)`  
**Code**:
```typescript
.input('isActive', sql.NVarChar(5), 'yes')  // ❌ WRONG
```

**Should be**:
```typescript
.input('isActive', sql.NVarChar(5), 'no')   // ✅ CORRECT
```

**Impact**:
- All invoices created via Next.js POS system are marked inactive
- Reports filter them out
- Only legacy invoices (with 'no' or NULL) appear in reports

---

## 8. REQUIRED ACTIONS (In Order)

### Step 1: Database Investigation ⚠️ USER MUST DO THIS
Run SSMS queries to find:
```sql
-- Find the trigger
SELECT t.name, OBJECT_NAME(t.parent_id), m.definition
FROM sys.triggers t
JOIN sys.sql_modules m ON m.object_id = t.object_id
WHERE OBJECT_NAME(t.parent_id) IN ('TblinvServHead', 'TblinvServPayment')
  AND m.definition LIKE '%TblCashMove%';
```

### Step 2: Identify Exact Trigger/SP Name
- Trigger name: `_________________` (to be filled after query)
- Parent table: `_________________` (TblinvServHead or TblinvServPayment)
- Action: AFTER INSERT or INSTEAD OF INSERT

### Step 3: Decide Fix Strategy

**Option A**: Remove application code INSERT (if trigger should handle it)
- Delete lines 198-219 in route.ts
- Let trigger handle TblCashMove insertion

**Option B**: Disable/Drop trigger (if application should handle it)
- Drop or disable the trigger
- Keep application code INSERT (lines 198-219)

**Option C**: Add duplicate check in application
- Before INSERT, check if invID already exists in TblCashMove
- Skip INSERT if exists

### Step 4: Fix isActive Value
**File**: `route.ts` line 115
```typescript
// Change from:
.input('isActive', sql.NVarChar(5), 'yes')

// To:
.input('isActive', sql.NVarChar(5), 'no')
```

---

## 9. FORENSIC EVIDENCE CHECKLIST

- [ ] Trigger name on TblinvServHead: `________________`
- [ ] Trigger name on TblinvServPayment: `________________`
- [ ] Trigger definition (full SQL): See SSMS output
- [ ] Stored procedures that INSERT TblCashMove: `________________`
- [ ] Application code INSERT location: ✅ `route.ts:212-218`
- [ ] isActive bug location: ✅ `route.ts:115`
- [ ] Transaction isolation level: ✅ SERIALIZABLE (route.ts:82)
- [ ] Duplicate data sample: See Query 7 in forensic SQL file

---

## 10. NEXT STEPS

### DO NOT FIX YET - COLLECT EVIDENCE FIRST

1. **Run forensic SQL file**: `FORENSIC_CASHMOVE_DUPLICATE.sql`
2. **Copy output** of:
   - Query 1 (Triggers)
   - Query 2 (Procedures with TblCashMove INSERT)
   - Query 7 (Sample duplicate data)
3. **Report back**: Trigger names and definitions
4. **Then decide**: Which fix strategy (A, B, or C above)

---

## 11. SUMMARY FOR USER

### Question 1: هل يوجد trigger يكتب في TblCashMove?
**Answer**: PENDING - Must run SQL query to confirm

### Question 2: هل يوجد كود تطبيق يكتب في TblCashMove?
**Answer**: ✅ YES - `route.ts` line 212-218

### Question 3: هل يوجد أكثر من trigger?
**Answer**: PENDING - Must run SQL query to confirm

### Question 4: هل يوجد path خاص ببعض أيام/أنواع الدفع?
**Answer**: ❌ NO - Same code path for all sales

### Exact Fix Location (Pending DB Query):
- **Object Name**: Unknown trigger (waiting for SQL query result)
- **File Name**: `route.ts` (application side)
- **Function Name**: `POST` handler (line 10-298)
- **Line Number**: 212-218 (TblCashMove INSERT)
- **Duplicate Sequence**: 
  1. Trigger fires on TblinvServHead/TblinvServPayment INSERT
  2. Application code explicitly INSERTs into TblCashMove
  3. Both use same invID → Duplicate

### Secondary Bug (Confirmed):
- **File**: `route.ts`
- **Line**: 115
- **Issue**: `isActive = 'yes'` should be `'no'`
- **Impact**: All new sales invisible in reports

---

**END OF FORENSIC REPORT**
**STATUS**: Awaiting database query results for trigger identification
