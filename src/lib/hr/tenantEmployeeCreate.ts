import 'server-only';
import { getPool, sql } from '@/lib/db';
import {
  mapNormalizedToDbColumns,
  usesHrModelPayload,
  validateEmployeeHrPayload,
  type EmployeeHrPayload,
} from '@/lib/hr/employee-hr-model';
import { buildHrInsertQuery } from '@/lib/hr/employee-hr-db';
import { ensureEmployeeAdvanceMapping } from '@/lib/hr/employee-hr-advance';
import { requireMasterDataTenantId } from '@/platform/masterData/tenantScope';

export class TenantEmployeeValidationError extends Error {
  readonly code = 'EMPLOYEE_INVALID' as const;
  readonly status = 400;
}

/**
 * Create one employee owned by `tenantId` with the same HR validation, insert shape and advance
 * category mapping as POST /api/employees. `hr` carries optional HR-model fields.
 */
export async function createTenantEmployee(input: {
  tenantId: string;
  name: string;
  job: string;
  isActive: boolean;
  hr?: Omit<EmployeeHrPayload, 'empName' | 'isActive'>;
}): Promise<{ empId: number }> {
  const tenantId = requireMasterDataTenantId(input.tenantId, 'createTenantEmployee');
  const name = input.name.trim();
  const payload: EmployeeHrPayload = { ...(input.hr ?? {}), empName: name, isActive: input.isActive };
  const isHrPayload = usesHrModelPayload(payload);
  const validation = validateEmployeeHrPayload(payload, { mode: 'create', isHrPayload });
  if (!validation.ok) {
    throw new TenantEmployeeValidationError(`${name}: ${validation.errors[0]}`);
  }

  const db = await getPool();
  const tx = new sql.Transaction(db);
  await tx.begin();
  try {
    let empId: number;
    if (isHrPayload && validation.normalized) {
      const { sql: insertSql, bind } = buildHrInsertQuery(
        tenantId,
        name,
        input.isActive,
        mapNormalizedToDbColumns(validation.normalized),
      );
      const req = new sql.Request(tx);
      bind(req);
      empId = Number((await req.query(insertSql)).recordset[0].EmpID);
    } else {
      // TblEmp has an enabled trigger, so SQL Server rejects OUTPUT without INTO here.
      const inserted = await new sql.Request(tx)
        .input('tenantId', sql.UniqueIdentifier, tenantId)
        .input('empName', sql.NVarChar(200), name)
        .input('isActive', sql.Bit, input.isActive ? 1 : 0)
        .query(`
          INSERT INTO dbo.TblEmp (TenantId, EmpName, isActive)
          VALUES (@tenantId, @empName, @isActive);

          SELECT EmpID
          FROM dbo.TblEmp
          WHERE EmpID = SCOPE_IDENTITY() AND TenantId = @tenantId;
        `);
      empId = Number(inserted.recordset[0].EmpID);
    }

    await new sql.Request(tx)
      .input('empId', sql.Int, empId)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('job', sql.NVarChar(50), input.job)
      .query(`UPDATE dbo.TblEmp SET Job = @job WHERE EmpID = @empId AND TenantId = @tenantId;`);

    await ensureEmployeeAdvanceMapping(tx, tenantId, empId, name);
    await tx.commit();
    return { empId };
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      /* already rolled back */
    }
    throw err;
  }
}
