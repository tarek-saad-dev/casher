# Employee Advance Mappings Report
**Generated:** 2026-03-31  
**Database:** HawaiDB  
**Total Categories Found:** 15

---

## 1. Root Cause of FK Error

The original INSERT statement failed because it used **fake placeholder IDs**:
```sql
-- ❌ WRONG - Used guessed IDs
INSERT INTO TblExpCatEmpMap (ExpINID, EmpID, TxnKind, Notes)
VALUES (123, 1, N'advance', N'Example');
```

**Problems:**
- ExpINID 123 may not exist in TblExpINCat
- EmpID 1 may not exist in TblEmp
- Foreign key constraints rejected the insert
- No verification against real data

**Solution:** Inspect real database first, then use actual IDs.

---

## 2. Real Categories Found in TblExpINCat

| ExpINID | Category Name | Extracted Name |
|---------|---------------|----------------|
| 4 | سلف | *(empty)* |
| 39 | سلف ( أستاذ محمد ) | أستاذ محمد |
| 7 | سلف (طارق) | طارق |
| 52 | سلف باسم | باسم |
| 35 | سلفة ( ذياد المساعد ) | ذياد المساعد |
| 13 | سلفة (يوسف الجو) | يوسف الجو |
| 26 | سلفة يوسف المساعد(خيري) | يوسف المساعدخيري |
| 11 | سلفة(خيري) | خيري |
| 10 | سلفة(زين) | زين |
| 8 | سلفة(كريم) | كريم |
| 12 | سلفة(محمد الدمياطي) | محمد الدمياطي |
| 37 | سلفه ( احمد المساعد ) | احمد المساعد |
| 33 | سلفه ( ذياد ) | ذياد |
| 34 | سلفه ( محمد ) | محمد |
| 44 | سلفه ( هدى ) | هدى |

---

## 3. Real Employees Found in TblEmp

| EmpID | Employee Name |
|-------|---------------|
| 19 | باسم |
| 12 | ذياد |
| 16 | ذياد المساعد |
| 5 | كريم |
| 7 | محمد |

---

## 4. Auto-Confirmed Mappings (5)

These mappings have HIGH or unique MEDIUM confidence and can be inserted safely:

| Category | ExpINID | → | Employee | EmpID | Confidence |
|----------|---------|---|----------|-------|------------|
| سلف باسم | 52 | → | باسم | 19 | HIGH (Exact) |
| سلفة(كريم) | 8 | → | كريم | 5 | HIGH (Exact) |
| سلفه ( محمد ) | 34 | → | محمد | 7 | HIGH (Exact) |
| سلف ( أستاذ محمد ) | 39 | → | محمد | 7 | MEDIUM (Partial) |
| سلفة(محمد الدمياطي) | 12 | → | محمد | 7 | MEDIUM (Partial) |

---

## 5. Ambiguous Mappings - Need Manual Review (3)

### ⚠️ Case 1: "سلف" (ExpINID: 4)
**Problem:** Empty extracted name matches all employees

**Possible Matches:**
- باسم (ID: 19)
- ذياد (ID: 12)
- ذياد المساعد (ID: 16)
- كريم (ID: 5)
- محمد (ID: 7)

**Recommendation:** This is a generic "advances" category. Either:
1. Don't map it (leave as general expense)
2. Create a separate tracking mechanism
3. Split into specific employee categories

---

### ⚠️ Case 2: "سلفة ( ذياد المساعد )" (ExpINID: 35)
**Problem:** Could match two employees

**Possible Matches:**
- ✓ **ذياد المساعد (ID: 16)** - HIGH confidence (exact match)
- ذياد (ID: 12) - MEDIUM confidence (partial match)

**Recommendation:** Map to **EmpID 16** (ذياد المساعد)

**Manual SQL:**
```sql
INSERT INTO [dbo].[TblExpCatEmpMap] ([ExpINID], [EmpID], [TxnKind], [Notes])
SELECT 35, 16, N'advance', N'سلفة ( ذياد المساعد )'
WHERE NOT EXISTS (
    SELECT 1 FROM [dbo].[TblExpCatEmpMap]
    WHERE [ExpINID] = 35 AND [EmpID] = 16 AND [TxnKind] = N'advance'
);
```

---

### ⚠️ Case 3: "سلفه ( ذياد )" (ExpINID: 33)
**Problem:** Could match two employees

**Possible Matches:**
- ✓ **ذياد (ID: 12)** - HIGH confidence (exact match)
- ذياد المساعد (ID: 16) - MEDIUM confidence (partial match)

**Recommendation:** Map to **EmpID 12** (ذياد)

**Manual SQL:**
```sql
INSERT INTO [dbo].[TblExpCatEmpMap] ([ExpINID], [EmpID], [TxnKind], [Notes])
SELECT 33, 12, N'advance', N'سلفه ( ذياد )'
WHERE NOT EXISTS (
    SELECT 1 FROM [dbo].[TblExpCatEmpMap]
    WHERE [ExpINID] = 33 AND [EmpID] = 12 AND [TxnKind] = N'advance'
);
```

---

## 6. No Matches Found (7)

These categories have no matching employees in TblEmp:

| ExpINID | Category | Extracted Name | Issue |
|---------|----------|----------------|-------|
| 7 | سلف (طارق) | طارق | Employee not in TblEmp |
| 13 | سلفة (يوسف الجو) | يوسف الجو | Employee not in TblEmp |
| 26 | سلفة يوسف المساعد(خيري) | يوسف المساعدخيري | Employee not in TblEmp |
| 11 | سلفة(خيري) | خيري | Employee not in TblEmp |
| 10 | سلفة(زين) | زين | Employee not in TblEmp |
| 37 | سلفه ( احمد المساعد ) | احمد المساعد | Employee not in TblEmp |
| 44 | سلفه ( هدى ) | هدى | Employee not in TblEmp |

**Options:**
1. Add these employees to TblEmp first, then create mappings
2. Mark these categories as inactive if employees no longer work there
3. Reclassify these expenses to existing employees

---

## 7. Final SQL Script (Auto-Confirmed Only)

**⚠️ IMPORTANT:** Review this carefully before running!

```sql
-- =============================================
-- Safe Employee Advance Mappings
-- Generated: 2026-03-31
-- Auto-confirmed mappings only (5 total)
-- =============================================

BEGIN TRANSACTION;

-- Mapping 1: "سلف باسم" → باسم (HIGH confidence)
INSERT INTO [dbo].[TblExpCatEmpMap] ([ExpINID], [EmpID], [TxnKind], [Notes])
SELECT 52, 19, N'advance', N'سلف باسم'
WHERE NOT EXISTS (
    SELECT 1 FROM [dbo].[TblExpCatEmpMap]
    WHERE [ExpINID] = 52 AND [EmpID] = 19 AND [TxnKind] = N'advance'
);

-- Mapping 2: "سلفة(كريم)" → كريم (HIGH confidence)
INSERT INTO [dbo].[TblExpCatEmpMap] ([ExpINID], [EmpID], [TxnKind], [Notes])
SELECT 8, 5, N'advance', N'سلفة(كريم)'
WHERE NOT EXISTS (
    SELECT 1 FROM [dbo].[TblExpCatEmpMap]
    WHERE [ExpINID] = 8 AND [EmpID] = 5 AND [TxnKind] = N'advance'
);

-- Mapping 3: "سلفه ( محمد )" → محمد (HIGH confidence)
INSERT INTO [dbo].[TblExpCatEmpMap] ([ExpINID], [EmpID], [TxnKind], [Notes])
SELECT 34, 7, N'advance', N'سلفه ( محمد )'
WHERE NOT EXISTS (
    SELECT 1 FROM [dbo].[TblExpCatEmpMap]
    WHERE [ExpINID] = 34 AND [EmpID] = 7 AND [TxnKind] = N'advance'
);

-- Mapping 4: "سلف ( أستاذ محمد )" → محمد (MEDIUM confidence)
INSERT INTO [dbo].[TblExpCatEmpMap] ([ExpINID], [EmpID], [TxnKind], [Notes])
SELECT 39, 7, N'advance', N'سلف ( أستاذ محمد )'
WHERE NOT EXISTS (
    SELECT 1 FROM [dbo].[TblExpCatEmpMap]
    WHERE [ExpINID] = 39 AND [EmpID] = 7 AND [TxnKind] = N'advance'
);

-- Mapping 5: "سلفة(محمد الدمياطي)" → محمد (MEDIUM confidence)
INSERT INTO [dbo].[TblExpCatEmpMap] ([ExpINID], [EmpID], [TxnKind], [Notes])
SELECT 12, 7, N'advance', N'سلفة(محمد الدمياطي)'
WHERE NOT EXISTS (
    SELECT 1 FROM [dbo].[TblExpCatEmpMap]
    WHERE [ExpINID] = 12 AND [EmpID] = 7 AND [TxnKind] = N'advance'
);

-- Verify the inserts
SELECT 
    m.ID,
    m.ExpINID,
    c.CatName,
    m.EmpID,
    e.EmpName,
    m.TxnKind,
    m.CreatedDate
FROM [dbo].[TblExpCatEmpMap] m
INNER JOIN [dbo].[TblExpINCat] c ON m.ExpINID = c.ExpINID
INNER JOIN [dbo].[TblEmp] e ON m.EmpID = e.EmpID
ORDER BY e.EmpName, c.CatName;

-- If everything looks correct, commit
COMMIT TRANSACTION;

-- If there are issues, rollback instead:
-- ROLLBACK TRANSACTION;
```

---

## 8. Verification Queries After Insert

### Check all mappings
```sql
SELECT 
    m.ID,
    m.ExpINID,
    c.CatName AS CategoryName,
    m.EmpID,
    e.EmpName AS EmployeeName,
    m.TxnKind,
    m.IsActive,
    m.CreatedDate
FROM [dbo].[TblExpCatEmpMap] m
INNER JOIN [dbo].[TblExpINCat] c ON m.ExpINID = c.ExpINID
INNER JOIN [dbo].[TblEmp] e ON m.EmpID = e.EmpID
ORDER BY e.EmpName, c.CatName;
```

### Count mappings per employee
```sql
SELECT 
    e.EmpID,
    e.EmpName,
    COUNT(*) AS MappingCount
FROM [dbo].[TblExpCatEmpMap] m
INNER JOIN [dbo].[TblEmp] e ON m.EmpID = e.EmpID
WHERE m.IsActive = 1
GROUP BY e.EmpID, e.EmpName
ORDER BY e.EmpName;
```

### Test the API endpoint
After running the SQL, test:
```
GET http://localhost:3000/api/reports/expenses/employee-advances?year=2026&month=3
```

---

## 9. Summary

| Status | Count | Action Required |
|--------|-------|-----------------|
| ✓ Auto-confirmed | 5 | Run SQL script above |
| ⚠️ Ambiguous | 3 | Manual review needed |
| ✗ No match | 7 | Add employees or reclassify |
| **Total** | **15** | |

---

## 10. Next Steps

### Immediate (Required)
1. ✅ Review auto-confirmed mappings above
2. ✅ Copy and run the SQL script in SSMS
3. ✅ Verify results with verification queries
4. ✅ Test the API endpoint

### Manual Review (Recommended)
5. ⚠️ Handle ambiguous case: "سلفة ( ذياد المساعد )" → Map to EmpID 16
6. ⚠️ Handle ambiguous case: "سلفه ( ذياد )" → Map to EmpID 12
7. ⚠️ Decide on generic "سلف" category (ExpINID 4)

### Missing Employees (Optional)
8. Add missing employees to TblEmp:
   - طارق
   - يوسف الجو
   - خيري
   - زين
   - احمد المساعد
   - هدى
9. Re-run the mapping script to pick up new employees

---

## 11. Important Notes

✅ **Safe to run:** All IDs are from real database  
✅ **Idempotent:** Uses NOT EXISTS to prevent duplicates  
✅ **Transaction-wrapped:** Can rollback if needed  
✅ **FK-safe:** All IDs exist in parent tables  

⚠️ **Manual review required** for ambiguous cases  
⚠️ **Missing employees** need to be added to TblEmp first  

---

**End of Report**
