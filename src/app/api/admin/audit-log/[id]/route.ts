import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';
import { getUserAccess } from '@/lib/permissions-server';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

// GET /api/admin/audit-log/[id] — read a single audit record
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

    const access = await getUserAccess(session.UserID, session.UserName, session.UserLevel);
    if (!access.isSuperAdmin) {
      return NextResponse.json({ error: 'غير مصرح — super_admin فقط' }, { status: 403 });
    }

    const { id } = await params;
    const auditId = parseInt(id, 10);
    if (isNaN(auditId)) {
      return NextResponse.json({ error: 'معرف سجل التدقيق غير صالح' }, { status: 400 });
    }

    const db = await getPool();
    const result = await db.request()
      .input('auditId', sql.BigInt, auditId)
      .query(`
        SELECT
          AuditID,
          ActionType,
          ActionLabel,
          EntityType,
          EntityID,
          PerformedByUserID,
          PerformedByUserName,
          UserRolesSnapshot,
          ActionMethod,
          EndpointPath,
          OldData,
          NewData,
          ChangedFields,
          Reason,
          RiskLevel,
          RequestID,
          IPAddress,
          UserAgent,
          ExecutionStatus,
          ErrorMessage,
          CreatedAt
        FROM dbo.TblSensitiveActionAuditLog
        WHERE AuditID = @auditId
      `);

    if (result.recordset.length === 0) {
      return NextResponse.json({ error: 'سجل التدقيق غير موجود' }, { status: 404 });
    }

    return NextResponse.json({ record: result.recordset[0] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/audit-log/[id]] GET error:', message);
    return NextResponse.json({ error: 'فشل قراءة سجل التدقيق' }, { status: 500 });
  }
}
