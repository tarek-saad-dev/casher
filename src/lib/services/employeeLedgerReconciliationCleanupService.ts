import 'server-only';

import { getPool, sql } from '@/lib/db';
import {
  EMP_LEDGER_REASON_ADVANCE,
  EMP_LEDGER_REF_TYPE_CASH_MOVE,
} from '@/lib/services/employeeLedgerDualWrite';

export interface AdvanceMappingUpsertResult {
  success: true;
  expInId: number;
  empId: number;
  empName: string;
  categoryName: string;
  txnKind: 'advance';
  created: boolean;
  reactivated: boolean;
}

export interface VoidLedgerEntryResult {
  success: true;
  ledgerEntryId: number;
  voidReason: string;
}

export class EmployeeLedgerCleanupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmployeeLedgerCleanupError';
  }
}

export function extractCategoryNameHints(categoryName: string | null): string[] {
  if (!categoryName) return [];

  const hints = new Set<string>();
  const parenMatches = categoryName.match(/\(([^)]+)\)/g) ?? [];
  for (const match of parenMatches) {
    const inner = match.replace(/[()]/g, '').trim();
    if (inner.length >= 2) hints.add(inner);
  }

  const stripped = categoryName
    .replace(/سلف(?:ة|ه)?/gi, '')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (stripped.length >= 2) hints.add(stripped);

  return Array.from(hints);
}

export async function suggestEmployeesByCategoryName(
  pool: { request: () => sql.Request },
  categoryName: string | null,
  limit = 5,
): Promise<Array<{ empId: number; empName: string; matchScore: number }>> {
  const hints = extractCategoryNameHints(categoryName);
  if (hints.length === 0) return [];

  const req = pool.request();
  const likeClauses: string[] = [];
  hints.forEach((hint, idx) => {
    const param = `hint${idx}`;
    req.input(param, sql.NVarChar(200), `%${hint}%`);
    likeClauses.push(`e.EmpName LIKE @${param}`);
  });

  const result = await req.query(`
    SELECT TOP (${limit})
      e.EmpID AS empId,
      e.EmpName AS empName
    FROM dbo.TblEmp e
    WHERE e.isActive = 1
      AND (${likeClauses.join(' OR ')})
    ORDER BY e.EmpName
  `);

  return result.recordset.map((row: Record<string, unknown>, idx: number) => ({
    empId: Number(row.empId),
    empName: String(row.empName),
    matchScore: hints.length - Math.min(idx, hints.length - 1),
  }));
}

export async function upsertAdvanceCategoryMapping(
  expInId: number,
  empId: number,
): Promise<AdvanceMappingUpsertResult> {
  if (!expInId || expInId <= 0) {
    throw new EmployeeLedgerCleanupError('ExpINID غير صالح');
  }
  if (!empId || empId <= 0) {
    throw new EmployeeLedgerCleanupError('empId غير صالح');
  }

  const db = await getPool();
  const transaction = new sql.Transaction(db);
  await transaction.begin();

  try {
    const categoryCheck = await new sql.Request(transaction)
      .input('expInId', sql.Int, expInId)
      .query(`
        SELECT ExpINID, CatName
        FROM dbo.TblExpINCat
        WHERE ExpINID = @expInId AND ExpINType = N'مصروفات'
      `);
    if (categoryCheck.recordset.length === 0) {
      throw new EmployeeLedgerCleanupError('تصنيف المصروف غير موجود أو ليس من نوع مصروفات');
    }
    const categoryName = String(categoryCheck.recordset[0].CatName);

    const empCheck = await new sql.Request(transaction)
      .input('empId', sql.Int, empId)
      .query(`
        SELECT EmpID, EmpName
        FROM dbo.TblEmp
        WHERE EmpID = @empId
      `);
    if (empCheck.recordset.length === 0) {
      throw new EmployeeLedgerCleanupError('الموظف غير موجود');
    }
    const empName = String(empCheck.recordset[0].EmpName);

    await new sql.Request(transaction)
      .input('expInId', sql.Int, expInId)
      .input('empId', sql.Int, empId)
      .query(`
        UPDATE dbo.TblExpCatEmpMap
        SET IsActive = 0,
            ModifiedDate = GETDATE(),
            Notes = CONCAT(ISNULL(Notes, N''), N' | Deactivated by reconciliation cleanup')
        WHERE ExpINID = @expInId
          AND TxnKind = N'advance'
          AND EmpID <> @empId
          AND IsActive = 1
      `);

    const existing = await new sql.Request(transaction)
      .input('expInId', sql.Int, expInId)
      .input('empId', sql.Int, empId)
      .query(`
        SELECT ID, IsActive
        FROM dbo.TblExpCatEmpMap
        WHERE ExpINID = @expInId
          AND EmpID = @empId
          AND TxnKind = N'advance'
      `);

    let created = false;
    let reactivated = false;

    if (existing.recordset.length === 0) {
      await new sql.Request(transaction)
        .input('expInId', sql.Int, expInId)
        .input('empId', sql.Int, empId)
        .query(`
          INSERT INTO dbo.TblExpCatEmpMap
            (EmpID, ExpINID, TxnKind, IsActive, Notes, CreatedDate, ModifiedDate)
          VALUES
            (@empId, @expInId, N'advance', 1,
             N'Reconciliation cleanup advance mapping', GETDATE(), GETDATE())
        `);
      created = true;
    } else {
      const wasActive = Boolean(existing.recordset[0].IsActive);
      await new sql.Request(transaction)
        .input('expInId', sql.Int, expInId)
        .input('empId', sql.Int, empId)
        .query(`
          UPDATE dbo.TblExpCatEmpMap
          SET IsActive = 1,
              ModifiedDate = GETDATE(),
              Notes = CONCAT(ISNULL(Notes, N''), N' | Reactivated by reconciliation cleanup')
          WHERE ExpINID = @expInId
            AND EmpID = @empId
            AND TxnKind = N'advance'
        `);
      reactivated = !wasActive;
    }

    await transaction.commit();

    return {
      success: true,
      expInId,
      empId,
      empName,
      categoryName,
      txnKind: 'advance',
      created,
      reactivated,
    };
  } catch (error) {
    try {
      await transaction.rollback();
    } catch {
      /* ignore */
    }
    if (error instanceof EmployeeLedgerCleanupError) throw error;
    throw new EmployeeLedgerCleanupError(
      error instanceof Error ? error.message : 'فشل تحديث ربط التصنيف',
    );
  }
}

export async function voidReconciliationLedgerEntry(
  ledgerEntryId: number,
  reason: string,
): Promise<VoidLedgerEntryResult> {
  const trimmedReason = reason.trim();
  if (!ledgerEntryId || ledgerEntryId <= 0) {
    throw new EmployeeLedgerCleanupError('ledgerEntryId غير صالح');
  }
  if (!trimmedReason) {
    throw new EmployeeLedgerCleanupError('سبب الإلغاء مطلوب');
  }

  const db = await getPool();
  const entryResult = await db.request()
    .input('ledgerEntryId', sql.Int, ledgerEntryId)
    .query(`
      SELECT
        ID,
        EntryReason,
        RefType,
        CashMoveID,
        IsVoided
      FROM dbo.TblEmpLedgerEntry
      WHERE ID = @ledgerEntryId
    `);

  if (entryResult.recordset.length === 0) {
    throw new EmployeeLedgerCleanupError('قيد الدفتر غير موجود');
  }

  const entry = entryResult.recordset[0];
  if (Boolean(entry.IsVoided)) {
    throw new EmployeeLedgerCleanupError('قيد الدفتر ملغى مسبقاً');
  }
  if (String(entry.EntryReason) !== EMP_LEDGER_REASON_ADVANCE) {
    throw new EmployeeLedgerCleanupError('يُسمح بإلغاء قيود السلف فقط من هذه الشاشة');
  }
  if (String(entry.RefType) !== EMP_LEDGER_REF_TYPE_CASH_MOVE) {
    throw new EmployeeLedgerCleanupError('يُسمح بإلغاء قيود السلف المرتبطة بحركات الخزنة فقط');
  }
  if (entry.CashMoveID == null) {
    throw new EmployeeLedgerCleanupError('قيد الدفتر لا يحتوي CashMoveID — لا يمكن إلغاؤه من التنظيف الآمن');
  }

  await db.request()
    .input('ledgerEntryId', sql.Int, ledgerEntryId)
    .input('voidReason', sql.NVarChar(500), trimmedReason.slice(0, 500))
    .query(`
      UPDATE dbo.TblEmpLedgerEntry
      SET IsVoided = 1,
          VoidReason = @voidReason,
          UpdatedAt = SYSDATETIME()
      WHERE ID = @ledgerEntryId
        AND IsVoided = 0
    `);

  return {
    success: true,
    ledgerEntryId,
    voidReason: trimmedReason,
  };
}
