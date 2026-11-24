# PRE-IMPLEMENTATION CHECKLIST - Staff Expense Distribution

**Date**: 2026-04-15  
**Status**: Ready for Implementation  
**Critical**: Review ALL items before proceeding

---

## DATABASE PREPARATION CHECKLIST

### 1. Backup Current Database
- [ ] **FULL DATABASE BACKUP** created
- [ ] Backup file stored safely
- [ ] Can restore if needed
- [ ] Test restore on non-production (if possible)

**Command**:
```sql
-- Create full backup
BACKUP DATABASE HawaiDB 
TO DISK = 'C:\Backups\HawaiDB_Before_StaffExpense_' + CONVERT(NVARCHAR, GETDATE(), 112) + '.bak'
WITH FORMAT, INIT;
```

---

### 2. Check Current Database State

#### Check Existing Tables
```sql
-- Verify these tables don't exist yet
SELECT TABLE_NAME 
FROM INFORMATION_SCHEMA.TABLES 
WHERE TABLE_NAME IN ('TblStaffExpenseDistribution', 'TblStaffExpenseDistributionDetail');

-- Should return 0 rows
```

#### Check Existing Triggers
```sql
-- Check if trigger already exists
SELECT name, is_disabled 
FROM sys.triggers 
WHERE name = 'trg_AutoDistributeStaffExpense';

-- Should return 0 rows
```

#### Check Existing Procedures
```sql
-- Check if procedure already exists
SELECT name 
FROM sys.procedures 
WHERE name = 'sp_DistributeStaffExpense';

-- Should return 0 rows
```

#### Check Existing Views
```sql
-- Check if view already exists
SELECT name 
FROM sys.views 
WHERE name = 'VwStaffExpenseSummary';

-- Should return 0 rows
```

---

### 3. Verify Required Tables Exist

#### Check Core Tables
```sql
-- These must exist
SELECT TABLE_NAME, COUNT(*) as ColumnCount
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME IN ('TblCashMove', 'TblExpINCat', 'TblEmp')
GROUP BY TABLE_NAME;

-- Expected:
-- TblCashMove: ~15 columns
-- TblExpINCat: ~5 columns  
-- TblEmp: ~10 columns
```

#### Check Required Columns
```sql
-- Verify TblCashMove has required columns
SELECT COLUMN_NAME, DATA_TYPE
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'TblCashMove'
  AND COLUMN_NAME IN ('ID', 'invID', 'invType', 'invDate', 'invTime', 'ExpINID', 'GrandTolal', 'inOut', 'Notes', 'ShiftMoveID', 'PaymentMethodID');

-- All should exist
```

#### Check Expense Categories
```sql
-- Verify expense categories exist
SELECT ExpINID, CatName, ExpINType
FROM [dbo].[TblExpINCat]
WHERE ExpINType = N'expenses'
ORDER BY CatName;

-- Should have at least "Internet" category
```

#### Check Staff Members
```sql
-- Verify staff members exist
SELECT EmpID, EmpName, IsActive
FROM [dbo].[TblEmp]
WHERE IsActive = 1
ORDER BY EmpName;

-- Should have your 6 staff members
```

---

### 4. Check Current Expense Data

#### Sample Current Expenses
```sql
-- Check current expense structure
SELECT TOP 5
  ID, invID, invType, invDate, ExpINID, GrandTolal, inOut, Notes
FROM [dbo].[TblCashMove]
WHERE invType = N'expenses' AND inOut = N'out'
ORDER BY ID DESC;

-- Should show current expense records
```

#### Check for Conflicts
```sql
-- Check if any invType = 'staff_expense' already exists
SELECT COUNT(*) as Count
FROM [dbo].[TblCashMove]
WHERE invType = N'staff_expense';

-- Should be 0
```

---

## APPLICATION CODE CHECKLIST

### 1. Verify Current API Structure

#### Check Expenses API
```typescript
// File should exist: src/app/api/expenses/route.ts
// Should have POST method that creates TblCashMove records
```

#### Check Dependencies
```json
// In pos-system/package.json, verify:
{
  "dependencies": {
    "mssql": "^9.1.1",  // or similar
    "next": "^14.0.0",
    // ... other dependencies
  }
}
```

### 2. Verify Database Connection

#### Test Connection
```typescript
// In your existing API, this should work:
import { getPool, sql } from '@/lib/db';

const db = await getPool();
const result = await db.request().query('SELECT 1 as test');
// Should return { test: 1 }
```

### 3. Check Current Expense Creation

#### Verify Current Implementation
```typescript
// In src/app/api/expenses/route.ts, verify:
// 1. Uses TblCashMove table
// 2. Sets invType = N'expenses'
// 3. Sets inOut = N'out'
// 4. Uses ExpINID for category
```

---

## ENVIRONMENT CHECKLIST

### 1. Development Environment
- [ ] Node.js version compatible
- [ ] npm packages up to date
- [ ] Database connection working
- [ ] POS system running normally

### 2. Production Environment (if applicable)
- [ ] Same checks as development
- [ ] Performance impact assessment
- [ ] Rollback plan documented

---

## RISK ASSESSMENT

### High Risk Items
1. **Database Schema Changes** - New tables/triggers
2. **Trigger Logic** - Could affect all expense creation
3. **Performance Impact** - Trigger fires on every expense

### Medium Risk Items
1. **API Changes** - New endpoints
2. **Frontend Integration** - New component
3. **Data Migration** - If needed

### Low Risk Items
1. **Reporting Views** - Read-only
2. **Documentation** - No code impact

---

## ROLLBACK PLAN

### If Database Changes Fail
```sql
-- Drop new objects
DROP TRIGGER IF EXISTS [dbo].[trg_AutoDistributeStaffExpense];
DROP PROCEDURE IF EXISTS [dbo].[sp_DistributeStaffExpense];
DROP VIEW IF EXISTS [dbo].[VwStaffExpenseSummary];
DROP TABLE IF EXISTS [dbo].[TblStaffExpenseDistributionDetail];
DROP TABLE IF EXISTS [dbo].[TblStaffExpenseDistribution];

-- Restore from backup if needed
```

### If Application Issues
- Revert to previous commit
- Remove new API endpoints
- Remove new component

---

## TESTING PLAN

### Pre-Implementation Tests
- [ ] Database backup successful
- [ ] All required tables exist
- [ ] Current expenses working
- [ ] API endpoints responding

### Post-Implementation Tests
- [ ] SQL script executes without errors
- [ ] New tables created correctly
- [ ] Trigger created and enabled
- [ ] API endpoints working
- [ ] Component renders correctly
- [ ] Test expense distribution works

### Performance Tests
- [ ] Expense creation time (before vs after)
- [ ] Database query performance
- [ ] Frontend rendering time

---

## IMPLEMENTATION STEPS (Sequential)

### Step 1: Database Setup
```sql
-- Execute: STAFF_EXPENSE_DISTRIBUTION.sql
-- Verify: All objects created successfully
-- Check: No errors in execution
```

### Step 2: Basic Configuration
```sql
-- Setup Internet category distribution
-- Verify: Distribution records created
-- Check: Percentages sum to 100%
```

### Step 3: API Testing
```bash
# Test new endpoints
curl http://localhost:5500/api/expenses/distribute
curl http://localhost:5500/api/expenses/distribute/summary
```

### Step 4: Frontend Integration
- Add component to expense page
- Test distribution management
- Verify save functionality

### Step 5: End-to-End Test
1. Create expense (260 EGP, Internet)
2. Verify original expense created
3. Verify automatic distribution
4. Check individual staff expenses
5. Verify totals match

---

## SUCCESS CRITERIA

### Database
- [ ] All SQL objects created without errors
- [ ] No conflicts with existing data
- [ ] Backup successfully created

### Functionality
- [ ] Expense creation still works
- [ ] Distribution triggers automatically
- [ ] Individual staff expenses created
- [ ] Totals match original amount

### Performance
- [ ] Expense creation time < 2 seconds
- [ ] No database deadlocks
- [ ] Frontend responsive

### Reporting
- [ ] Distribution summary view works
- [ ] Staff expense reports accurate
- [ ] Historical data preserved

---

## FINAL VERIFICATION

### Before Going Live
- [ ] All checklist items completed
- [ ] Test scenarios passed
- [ ] Performance acceptable
- [ ] Documentation complete
- [ ] Team trained on new feature

### Post-Launch Monitoring
- [ ] Monitor expense creation errors
- [ ] Check distribution accuracy
- [ ] Watch database performance
- [ ] Collect user feedback

---

## CONTACT INFORMATION

**Issues During Implementation**:
- Database: Contact DBA immediately
- Application: Check logs and rollback if needed
- Performance: Monitor and optimize

**Post-Launch Support**:
- Documentation available in guide
- Rollback procedures documented
- Monitoring alerts configured

---

## SIGN-OFF

**Database Administrator**: ___________________ Date: _______

**Application Developer**: ___________________ Date: _______

**System Administrator**: ___________________ Date: _______

**Business Owner**: ___________________ Date: _______

---

**READY TO PROCEED?** 
- [ ] YES - All checks completed
- [ ] NO - Issues need resolution

**NOTES**: _________________________________________________________________________
_______________________________________________________________________________________
