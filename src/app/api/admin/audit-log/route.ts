import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';
import { getUserAccess } from '@/lib/permissions-server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

    const access = await getUserAccess(session.UserID, session.UserName, session.UserLevel);
    if (!access.isSuperAdmin) {
      return NextResponse.json({ error: 'غير مصرح — super_admin فقط' }, { status: 403 });
    }

    const searchParams = req.nextUrl.searchParams;
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10)));
    const actionType = searchParams.get('actionType') || undefined;
    const entityType = searchParams.get('entityType') || undefined;
    const entityId = searchParams.get('entityId') || undefined;
    const status = searchParams.get('status') || undefined;
    const userId = searchParams.get('userId') || undefined;
    const fromDate = searchParams.get('from') || undefined;
    const toDate = searchParams.get('to') || undefined;

    const db = await getPool();
    const conditions: string[] = ['1=1'];
    const request = db.request();

    if (actionType) {
      conditions.push('ActionType = @actionType');
      request.input('actionType', sql.NVarChar(100), actionType);
    }
    if (entityType) {
      conditions.push('EntityType = @entityType');
      request.input('entityType', sql.NVarChar(100), entityType);
    }
    if (entityId) {
      conditions.push('EntityID = @entityId');
      request.input('entityId', sql.NVarChar(200), entityId);
    }
    if (status) {
      conditions.push('ExecutionStatus = @status');
      request.input('status', sql.NVarChar(30), status);
    }
    if (userId) {
      conditions.push('PerformedByUserID = @userId');
      request.input('userId', sql.Int, parseInt(userId, 10));
    }
    if (fromDate) {
      conditions.push('CreatedAt >= @fromDate');
      request.input('fromDate', sql.DateTime2, new Date(fromDate));
    }
    if (toDate) {
      conditions.push('CreatedAt < @toDate');
      request.input('toDate', sql.DateTime2, new Date(toDate));
    }

    const whereClause = conditions.join(' AND ');

    const countRes = await request.query(`
      SELECT COUNT(*) AS total
      FROM dbo.TblSensitiveActionAuditLog
      WHERE ${whereClause}
    `);
    const total = (countRes.recordset[0]?.total as number) ?? 0;

    request.input('offset', sql.Int, (page - 1) * pageSize);
    request.input('pageSize', sql.Int, pageSize);

    const dataRes = await request.query(`
      SELECT
        AuditID,
        ActionType,
        ActionLabel,
        EntityType,
        EntityID,
        PerformedByUserID,
        PerformedByUserName,
        ActionMethod,
        EndpointPath,
        OldData,
        NewData,
        ChangedFields,
        Reason,
        RiskLevel,
        ExecutionStatus,
        ErrorMessage,
        CreatedAt
      FROM dbo.TblSensitiveActionAuditLog
      WHERE ${whereClause}
      ORDER BY CreatedAt DESC
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `);

    return NextResponse.json({
      items: dataRes.recordset,
      total,
      page,
      pageSize,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/audit-log] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
