import { sql } from '@/lib/db';

export interface AdvanceMappingResult {
  expINID: number;
  catName: string;
}

/**
 * Creates or reuses advance expense category and employee mapping.
 * Preserves existing employee-creation side effects.
 */
export async function ensureEmployeeAdvanceMapping(
  transaction: sql.Transaction,
  empId: number,
  empName: string,
): Promise<AdvanceMappingResult> {
  const catName = `سلفه ( ${empName} )`;
  const expType = 'مصروفات';

  let expINID = 0;

  const existCat = await new sql.Request(transaction)
    .input('catName', sql.NVarChar(200), catName)
    .input('expType', sql.NVarChar(50), expType)
    .query(`
      SELECT ExpINID FROM dbo.TblExpINCat
      WHERE CatName = @catName AND ExpINType = @expType
    `);

  if (existCat.recordset.length > 0) {
    expINID = existCat.recordset[0].ExpINID;
  } else {
    const catRes = await new sql.Request(transaction)
      .input('catName', sql.NVarChar(200), catName)
      .input('expType', sql.NVarChar(50), expType)
      .query(`
        INSERT INTO dbo.TblExpINCat (CatName, ExpINType)
        OUTPUT INSERTED.ExpINID
        VALUES (@catName, @expType)
      `);
    expINID = catRes.recordset[0].ExpINID;
  }

  if (!expINID || expINID <= 0) {
    throw new Error('فشل في إنشاء/العثور على تصنيف السلفة');
  }

  const existMap = await new sql.Request(transaction)
    .input('empID', sql.Int, empId)
    .input('expINID', sql.Int, expINID)
    .query(`
      SELECT 1 FROM dbo.TblExpCatEmpMap
      WHERE EmpID = @empID AND ExpINID = @expINID AND TxnKind = N'advance'
    `);

  if (existMap.recordset.length === 0) {
    await new sql.Request(transaction)
      .input('empID', sql.Int, empId)
      .input('expINID', sql.Int, expINID)
      .query(`
        INSERT INTO dbo.TblExpCatEmpMap
          (EmpID, ExpINID, TxnKind, IsActive, Notes, CreatedDate, ModifiedDate)
        VALUES
          (@empID, @expINID, N'advance', 1,
           N'Auto map on employee creation', GETDATE(), GETDATE())
      `);
  }

  return { expINID, catName };
}
