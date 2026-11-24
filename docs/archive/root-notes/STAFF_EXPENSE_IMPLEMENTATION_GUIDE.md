# Staff Expense Distribution System - Implementation Guide

**Date**: 2026-04-15  
**Purpose**: Automatically distribute shared expenses among staff members

---

## OVERVIEW

This system allows you to automatically distribute certain expenses (like Internet, utilities, etc.) among all staff members. When you create an expense for a category that has distribution setup, the system will automatically create individual expense records for each staff member.

---

## SETUP INSTRUCTIONS

### Step 1: Run Database Setup

Execute the SQL script to create the necessary tables and procedures:

```sql
-- Run this in SQL Server Management Studio
-- File: STAFF_EXPENSE_DISTRIBUTION.sql
```

This will create:
- `TblStaffExpenseDistribution` - Distribution settings
- `TblStaffExpenseDistributionDetail` - Distribution history
- `sp_DistributeStaffExpense` - Distribution procedure
- `trg_AutoDistributeStaffExpense` - Auto-trigger
- `VwStaffExpenseSummary` - Summary view

---

### Step 2: Configure Staff Distribution

#### Option A: Using API

```javascript
// GET available categories and staff
const response = await fetch('/api/expenses/distribute');
const { categories, staff } = await response.json();

// Setup distribution for Internet category (16.67% each for 6 staff)
await fetch('/api/expenses/distribute', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    distributions: [
      { expenseCategoryId: 1, staffMemberId: 1, distributionPercentage: 16.67 },
      { expenseCategoryId: 1, staffMemberId: 2, distributionPercentage: 16.67 },
      { expenseCategoryId: 1, staffMemberId: 3, distributionPercentage: 16.67 },
      { expenseCategoryId: 1, staffMemberId: 4, distributionPercentage: 16.67 },
      { expenseCategoryId: 1, staffMemberId: 5, distributionPercentage: 16.67 },
      { expenseCategoryId: 1, staffMemberId: 6, distributionPercentage: 16.67 }
    ]
  })
});
```

#### Option B: Using SQL Directly

```sql
-- Setup equal distribution for Internet category (ExpINID = 1)
DECLARE @InternetCategoryID INT = 1; -- Replace with actual Internet category ID
DECLARE @StaffMembers TABLE (EmpID INT);

-- Add your actual staff member IDs
INSERT INTO @StaffMembers (EmpID) VALUES 
(1), (2), (3), (4), (5), (6); -- Replace with actual EmpIDs

-- Clear existing distribution
DELETE FROM TblStaffExpenseDistribution WHERE ExpenseCategoryID = @InternetCategoryID;

-- Insert equal distribution (16.67% each)
INSERT INTO TblStaffExpenseDistribution (
    ExpenseCategoryID, StaffMemberID, DistributionPercentage, IsActive
)
SELECT 
    @InternetCategoryID,
    EmpID,
    16.67, -- Equal for 6 staff members
    1
FROM @StaffMembers;
```

---

### Step 3: Test the System

#### Create an Expense

1. Go to the expenses page in your POS system
2. Select "Internet" category (or whatever category you configured)
3. Enter amount: 260 EGP
4. Save the expense

#### What Happens Automatically

1. **Original Expense**: Creates one record in `TblCashMove` for 260 EGP (Internet)
2. **Distribution Trigger**: Fires automatically
3. **Staff Expenses**: Creates 6 separate records in `TblCashMove`:
   - Mohamed: 43.34 EGP
   - Karim: 43.34 EGP  
   - Bassem: 43.34 EGP
   - Hoda: 43.34 EGP
   - Ziad: 43.34 EGP
   - Ziad Assistant: 43.32 EGP (rounding adjustment)

#### Verify Results

```sql
-- Check original expense
SELECT * FROM TblCashMove 
WHERE invType = N'expenses' AND GrandTolal = 260;

-- Check distributed expenses  
SELECT * FROM TblCashMove 
WHERE invType = N'staff_expense' AND ExpINID = 1;

-- Check distribution details
SELECT 
  e.EmpName,
  ded.DistributedAmount,
  ded.CreatedDate
FROM TblStaffExpenseDistributionDetail ded
INNER JOIN TblEmp e ON ded.StaffMemberID = e.EmpID
WHERE ded.OriginalExpenseID = [original_expense_id];
```

---

## API ENDPOINTS

### 1. Get Distribution Settings
```
GET /api/expenses/distribute
```

Returns:
```json
{
  "distributions": [
    {
      "ID": 1,
      "ExpenseCategoryID": 1,
      "ExpenseCategoryName": "Internet",
      "StaffMemberID": 1,
      "StaffMemberName": "Mohamed",
      "DistributionPercentage": 16.67,
      "IsActive": true
    }
  ],
  "categories": [
    {"ExpINID": 1, "CatName": "Internet"},
    {"ExpINID": 2, "CatName": "Electricity"}
  ],
  "staff": [
    {"EmpID": 1, "EmpName": "Mohamed"},
    {"EmpID": 2, "EmpName": "Karim"}
  ]
}
```

### 2. Create/Update Distribution
```
POST /api/expenses/distribute
```

Body:
```json
{
  "expenseCategoryId": 1,
  "staffMemberId": 1,
  "distributionPercentage": 16.67
}
```

### 3. Update Multiple Distributions
```
PUT /api/expenses/distribute
```

Body:
```json
{
  "distributions": [
    {"expenseCategoryId": 1, "staffMemberId": 1, "distributionPercentage": 16.67},
    {"expenseCategoryId": 1, "staffMemberId": 2, "distributionPercentage": 16.67}
  ]
}
```

### 4. Get Distribution Summary
```
GET /api/expenses/distribute/summary?dateFrom=2026-04-01&dateTo=2026-04-30
```

Returns:
```json
{
  "details": [
    {
      "EmpID": 1,
      "EmpName": "Mohamed",
      "ExpenseCategory": "Internet",
      "DistributionCount": 5,
      "TotalDistributed": 216.70,
      "AverageDistribution": 43.34,
      "StaffTotal": 650.10,
      "CategoryTotal": 1300.20
    }
  ],
  "summary": {
    "StaffCount": 6,
    "CategoryCount": 3,
    "TotalDistributions": 18,
    "TotalAmount": 1300.20,
    "AverageAmount": 72.23
  }
}
```

---

## FRONTEND COMPONENT

### StaffExpenseDistribution Component

Use the React component to manage distributions:

```tsx
import StaffExpenseDistribution from '@/components/expenses/StaffExpenseDistribution';

export default function ExpenseManagement() {
  return (
    <div>
      <h1>Expense Management</h1>
      <StaffExpenseDistribution />
    </div>
  );
}
```

Features:
- Category selection dropdown
- Equal distribution button
- Percentage adjustment per staff member
- Real-time total percentage validation
- Save distribution settings
- Example calculation display

---

## EXAMPLE SCENARIOS

### Scenario 1: Internet Bill (260 EGP)

**Setup**: 6 staff members, equal distribution (16.67% each)

**Result**:
- Original: 1 expense for 260 EGP (Internet)
- Distributed: 6 expenses for ~43.34 EGP each
- Total: 260 EGP (with rounding adjustment)

### Scenario 2: Utilities (500 EGP)

**Setup**: 5 staff members, custom distribution
- Manager: 30% (150 EGP)
- Staff: 17.5% each (87.50 EGP)

**Result**:
- Original: 1 expense for 500 EGP (Utilities)
- Distributed: 5 expenses with custom amounts
- Total: 500 EGP exactly

### Scenario 3: Partial Distribution

**Setup**: Only 3 out of 6 staff members should pay

**Result**:
- Only active staff members get distribution
- Percentages should sum to 100% for active members only

---

## REPORTING

### Staff Expense Summary View

```sql
SELECT * FROM VwStaffExpenseSummary
WHERE ExpenseCategory = N'Internet'
ORDER BY EmpName;
```

### Monthly Distribution Report

```sql
SELECT 
  e.EmpName,
  cat.CatName,
  SUM(cm.GrandTolal) AS TotalAmount,
  COUNT(cm.ID) AS Count
FROM VwStaffExpenseSummary ves
INNER JOIN TblEmp e ON ves.EmpID = e.EmpID
INNER JOIN TblExpINCat cat ON ves.ExpenseCategoryID = cat.ExpINID
INNER JOIN TblCashMove cm ON ves.ExpenseCategoryID = cm.ExpINID
WHERE cm.invDate >= '2026-04-01' AND cm.invDate <= '2026-04-30'
GROUP BY e.EmpName, cat.CatName
ORDER BY e.EmpName, cat.CatName;
```

---

## TROUBLESHOOTING

### Issue: Distribution not working
**Check**:
1. Trigger is enabled: `SELECT name, is_disabled FROM sys.triggers WHERE name = 'trg_AutoDistributeStaffExpense'`
2. Category has distribution setup: `SELECT * FROM TblStaffExpenseDistribution WHERE ExpenseCategoryID = [category_id]`
3. Expense type is correct: Should be `N'expenses'` not `N'expense'`

### Issue: Rounding errors
**Solution**: The system automatically adjusts the first staff member for rounding differences.

### Issue: Double distribution
**Check**: Make sure the trigger is not fired multiple times. The trigger only processes `invType = N'expenses'`.

---

## MAINTENANCE

### Monthly Tasks
1. Review distribution percentages
2. Update staff member list (add/remove)
3. Verify totals match original expenses

### When Staff Changes
1. Add new staff to distribution table
2. Adjust percentages to total 100%
3. Deactivate inactive staff members

---

## FILES CREATED

1. **Database**: `STAFF_EXPENSE_DISTRIBUTION.sql`
2. **API**: `src/app/api/expenses/distribute/route.ts`
3. **API**: `src/app/api/expenses/distribute/summary/route.ts`
4. **Component**: `src/components/expenses/StaffExpenseDistribution.tsx`
5. **Guide**: `STAFF_EXPENSE_IMPLEMENTATION_GUIDE.md`

---

## NEXT STEPS

1. **Run the SQL script** to setup database
2. **Configure your staff distribution** for Internet category
3. **Test with a 260 EGP expense**
4. **Verify the automatic distribution**
5. **Add the component to your expense management page**

---

**Ready to use!** The system will now automatically distribute any expense in configured categories among your staff members.
