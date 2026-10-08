import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { requireTenantSession } from '@/lib/api-auth';
import { requireMasterDataTenantId } from '@/platform/masterData/tenantScope';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireTenantSession();
    if (session instanceof NextResponse) return session;

    const { id } = await params;
    const empId = parseInt(id);
    if (isNaN(empId)) {
      return NextResponse.json({ error: "معرف الموظف غير صحيح" }, { status: 400 });
    }

    const db = await getPool();
    
    const result = await db
      .request()
      .input("empId", sql.Int, empId)
      .input("tenantId", sql.UniqueIdentifier, requireMasterDataTenantId(session.TenantId, 'PATCH /api/admin/employees/[id]/activate'))
      .query(`
        UPDATE dbo.TblEmp
        SET isActive = 1
        WHERE EmpID = @empId AND TenantId = @tenantId
      `);

    if (result.rowsAffected[0] === 0) {
      return NextResponse.json({ error: "الموظف غير موجود" }, { status: 404 });
    }

    return NextResponse.json({ 
      success: true,
      message: "تم تفعيل الموظف بنجاح"
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/admin/employees/[id]/activate] PATCH error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
