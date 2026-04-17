# Employee Advances vs Revenue Tracking Feature

## Overview

This feature transforms raw expense category data into actionable employee financial tracking by:
- Mapping expense categories to employees via a proper database table
- Calculating employee advances from expense transactions
- Calculating employee revenue from sales detail lines
- Showing net position (revenue - advances) with risk assessment
- Providing manager-friendly UI with visual indicators

---

## Database Schema

### TblExpCatEmpMap (New Additive Table)

**Purpose:** Map expense categories that represent employee-linked transactions to actual employees.

**Columns:**
- `ID` (INT, PK, IDENTITY) - Primary key
- `ExpINID` (INT, NOT NULL, FK) - Foreign key to TblExpINCat (expense category)
- `EmpID` (INT, NOT NULL, FK) - Foreign key to TblEmp (employee)
- `TxnKind` (NVARCHAR(20), NOT NULL) - Transaction type: 'advance' or 'deduction'
- `IsActive` (BIT, NOT NULL, DEFAULT 1) - Soft delete flag
- `Notes` (NVARCHAR(500), NULL) - Optional notes for admin
- `CreatedDate` (DATETIME, NOT NULL, DEFAULT GETDATE())
- `ModifiedDate` (DATETIME, NOT NULL, DEFAULT GETDATE())

**Constraints:**
- FK to TblExpINCat.ExpINID
- FK to TblEmp.EmpID
- CHECK constraint on TxnKind (must be 'advance' or 'deduction')

**Indexes:**
- IX_ExpCatEmpMap_ExpINID (includes EmpID, TxnKind, IsActive)
- IX_ExpCatEmpMap_EmpID (includes ExpINID, TxnKind, IsActive)
- IX_ExpCatEmpMap_Active (filtered where IsActive = 1)

---

## Setup Instructions

### 1. Run Database Migration

Execute the SQL migration file:
```bash
# Location: db/migrations/create-tbl-exp-cat-emp-map.sql
```

Run in SQL Server Management Studio or via command line:
```sql
sqlcmd -S your_server -d your_database -i create-tbl-exp-cat-emp-map.sql
```

Verify table creation:
```sql
SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TblExpCatEmpMap';
```

### 2. Map Expense Categories to Employees

You need to create mappings between expense categories and employees. 

**Example: Find your advance categories**
```sql
SELECT ExpINID, CatName 
FROM TblExpINCat 
WHERE ExpINType = N'مصروفات'
  AND (CatName LIKE N'%سلف%' OR CatName LIKE N'%سلفة%')
ORDER BY CatName;
```

**Example: Find your employees**
```sql
SELECT EmpID, EmpName 
FROM TblEmp 
WHERE IsActive = 1
ORDER BY EmpName;
```

**Create mappings:**
```sql
-- Map "سلفه ( محمد )" category to محمد employee
INSERT INTO TblExpCatEmpMap (ExpINID, EmpID, TxnKind, Notes)
VALUES (123, 1, N'advance', N'سلفه ( محمد )');

-- Map "سلفة(كريم)" category to كريم employee
INSERT INTO TblExpCatEmpMap (ExpINID, EmpID, TxnKind, Notes)
VALUES (124, 4, N'advance', N'سلفة(كريم)');

-- Add more mappings as needed...
```

### 3. Verify Setup

Test the API endpoint:
```bash
curl "http://localhost:3000/api/reports/expenses/employee-advances?year=2026&month=3"
```

Expected response:
```json
[
  {
    "EmpID": 1,
    "EmpName": "محمد",
    "TotalAdvances": 3000.00,
    "AdvanceCount": 5,
    "LatestAdvanceDate": "2026-03-25",
    "TotalRevenue": 15000.00,
    "SalesCount": 12,
    "Remaining": 12000.00,
    "AdvancePercentage": 20.0,
    "RiskStatus": {
      "level": "safe",
      "label": "آمن",
      "color": "bg-green-500",
      "textColor": "text-green-600",
      "description": "السلف أقل من 30% من الإيرادات"
    }
  }
]
```

---

## Feature Usage

### Accessing the Report

1. Navigate to: **Reports → Monthly Expenses Report**
2. Select year and month
3. Click "تحديث" (Update)
4. Click the **"سلف الموظفين"** (Employee Advances) tab

### Understanding the UI

#### Summary Header
Shows aggregate statistics:
- **عدد الموظفين** - Number of employees with advances
- **إجمالي السلف** - Total advances (RED)
- **إجمالي الإيرادات** - Total revenue (GREEN)
- **حالات الخطر** - Risk status counts

#### Employee Cards
Each card displays:
- **Employee name** with risk badge
- **Revenue** (green) - Total sales revenue for the month
- **Advances** (red) - Total advances taken
- **Remaining** - Net position (revenue - advances)
- **Percentage** - Advances as % of revenue with progress bar
- **Transaction counts** - Number of sales and advance transactions
- **Latest advance date**
- **Risk description**

### Risk Status Levels

| Level | Label | Color | Condition | Action |
|-------|-------|-------|-----------|--------|
| **Safe** | آمن | Green | < 30% | Normal operations |
| **Watch** | مراقبة | Yellow | 30-60% | Monitor closely |
| **High** | خطر عالي | Orange | > 60% | Review immediately |
| **Critical** | حرج | Red | Advances but no revenue | Urgent action needed |

---

## Calculation Logic

### Employee Advances
```sql
SELECT 
  em.EmpID,
  e.EmpName,
  SUM(cm.GrandTolal) AS TotalAdvances,
  COUNT(cm.ID) AS AdvanceCount
FROM TblExpCatEmpMap em
INNER JOIN TblCashMove cm ON em.ExpINID = cm.ExpINID
INNER JOIN TblEmp e ON em.EmpID = e.EmpID
WHERE em.IsActive = 1
  AND em.TxnKind = N'advance'
  AND cm.invType = N'مصروفات'
  AND cm.inOut = N'out'
  AND YEAR(cm.invDate) = @year
  AND MONTH(cm.invDate) = @month
GROUP BY em.EmpID, e.EmpName
```

### Employee Revenue
```sql
SELECT 
  d.EmpID,
  SUM(d.SValue) AS TotalRevenue,
  COUNT(DISTINCT h.invID) AS SalesCount
FROM [dbo].[TblinvServDetail] d
INNER JOIN [dbo].[TblinvServHead] h ON d.invID = h.invID AND d.invType = h.invType
WHERE h.invType = N'مبيعات'
  AND YEAR(h.invDate) = @year
  AND MONTH(h.invDate) = @month
  AND d.EmpID IS NOT NULL
GROUP BY d.EmpID
```

### Calculations
- **Remaining** = TotalRevenue - TotalAdvances
- **Percentage** = (TotalAdvances / TotalRevenue) × 100
- **Risk Status** = Based on percentage thresholds

---

## API Endpoints

### GET /api/reports/expenses/employee-advances

**Query Parameters:**
- `year` (required) - Year (e.g., 2026)
- `month` (required) - Month (1-12)

**Response:** Array of `EmployeeAdvanceData` objects

**Example:**
```bash
GET /api/reports/expenses/employee-advances?year=2026&month=3
```

---

## Maintenance

### Adding New Employee Mappings

```sql
INSERT INTO TblExpCatEmpMap (ExpINID, EmpID, TxnKind, Notes)
VALUES (@ExpINID, @EmpID, N'advance', N'Description');
```

### Updating Existing Mappings

```sql
UPDATE TblExpCatEmpMap
SET EmpID = @NewEmpID,
    ModifiedDate = GETDATE()
WHERE ID = @MappingID;
```

### Soft Deleting Mappings

```sql
UPDATE TblExpCatEmpMap
SET IsActive = 0,
    ModifiedDate = GETDATE()
WHERE ID = @MappingID;
```

### Viewing All Mappings

```sql
SELECT 
  m.ID,
  m.ExpINID,
  c.CatName,
  m.EmpID,
  e.EmpName,
  m.TxnKind,
  m.IsActive,
  m.Notes
FROM TblExpCatEmpMap m
INNER JOIN TblExpINCat c ON m.ExpINID = c.ExpINID
INNER JOIN TblEmp e ON m.EmpID = e.EmpID
ORDER BY e.EmpName, c.CatName;
```

---

## Troubleshooting

### No data showing in Employee Advances tab

**Check 1:** Verify mappings exist
```sql
SELECT COUNT(*) FROM TblExpCatEmpMap WHERE IsActive = 1;
```

**Check 2:** Verify advances exist for the selected month
```sql
SELECT cm.*, cat.CatName
FROM TblCashMove cm
INNER JOIN TblExpINCat cat ON cm.ExpINID = cat.ExpINID
INNER JOIN TblExpCatEmpMap map ON cm.ExpINID = map.ExpINID
WHERE map.IsActive = 1
  AND map.TxnKind = N'advance'
  AND YEAR(cm.invDate) = 2026
  AND MONTH(cm.invDate) = 3;
```

**Check 3:** Verify employee revenue exists
```sql
SELECT d.EmpID, e.EmpName, SUM(d.LineTotal) AS Revenue
FROM TblinvServDetail d
INNER JOIN TblinvServHead h ON d.invID = h.invID
INNER JOIN TblEmp e ON d.EmpID = e.EmpID
WHERE h.invType = N'مبيعات'
  AND YEAR(h.invDate) = 2026
  AND MONTH(h.invDate) = 3
GROUP BY d.EmpID, e.EmpName;
```

### API returns 500 error

Check server logs for SQL errors. Common issues:
- Missing foreign key relationships
- Incorrect table names
- Permission issues

### Employee shows critical risk but has revenue

Verify the revenue calculation is working:
```sql
-- Check if employee has sales in TblinvServDetail
SELECT * FROM TblinvServDetail 
WHERE EmpID = @EmpID 
  AND invID IN (
    SELECT invID FROM TblinvServHead 
    WHERE YEAR(invDate) = @year AND MONTH(invDate) = @month
  );
```

---

## Future Enhancements

### Phase 2 (Optional)
- Admin UI for managing TblExpCatEmpMap mappings
- Bulk import/export of mappings
- Historical trend charts (advance patterns over time)
- Email alerts for high-risk employees
- Advance approval workflow
- Employee advance limits and policies

---

## Technical Notes

### Why a Mapping Table?

**Problem with string parsing:**
- Category names like "سلفه ( ذياد )" are inconsistent
- Typos, spacing, format changes break parsing
- No way to handle renames or employee changes

**Solution with TblExpCatEmpMap:**
- Explicit ExpINID → EmpID relationship
- Type-safe with TxnKind field
- Maintainable without touching legacy data
- Additive (no modification to existing tables)
- Auditable with timestamps

### Performance Considerations

- Indexes on ExpINID and EmpID ensure fast lookups
- Filtered index on IsActive for active mappings only
- API sorts by risk level for manager priority
- Revenue calculation uses existing sales detail structure

### Data Integrity

- Foreign key constraints prevent orphaned records
- CHECK constraint ensures valid TxnKind values
- Soft delete (IsActive flag) preserves history
- Timestamps track when mappings were created/modified

---

## Support

For issues or questions:
1. Check troubleshooting section above
2. Verify database schema matches migration
3. Test API endpoint directly
4. Check browser console for frontend errors
5. Review server logs for backend errors

---

**Last Updated:** 2026-03-30
**Version:** 1.0.0
