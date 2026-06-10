import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import sql from 'mssql';
import { getSession } from '@/lib/session';
import { getUserAccess } from '@/lib/permissions-server';

// GET /api/admin/approvals — list approval requests (super_admin only)
// Query params: status, requestType, requestedBy, dateFrom, dateTo
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

  const access = await getUserAccess(session.UserID, session.UserName, session.UserLevel);
  if (!access.isSuperAdmin) return NextResponse.json({ error: 'super_admin only' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const status      = searchParams.get('status');
  const requestType = searchParams.get('requestType');
  const requestedBy = searchParams.get('requestedBy');
  const dateFrom    = searchParams.get('dateFrom');
  const dateTo      = searchParams.get('dateTo');

  const where: string[] = [];
  const request = (await getPool()).request();

  if (status)      { where.push('ar.Status = @status');                    request.input('status',      sql.NVarChar, status); }
  if (requestType) { where.push('ar.RequestType = @requestType');          request.input('requestType', sql.NVarChar, requestType); }
  if (requestedBy) { where.push('ar.RequestedByUserID = @requestedBy');    request.input('requestedBy', sql.Int,      parseInt(requestedBy)); }
  if (dateFrom)    { where.push('ar.CreatedAt >= @dateFrom');              request.input('dateFrom',    sql.Date,     new Date(dateFrom)); }
  if (dateTo)      { where.push('ar.CreatedAt <  DATEADD(day,1,@dateTo)'); request.input('dateTo',      sql.Date,     new Date(dateTo)); }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const result = await request.query(`
    SELECT
      ar.ApprovalID, ar.RequestType, ar.EntityType, ar.EntityID,
      ar.ActionMethod, ar.Status, ar.RiskLevel, ar.Reason,
      ar.CreatedAt, ar.ReviewedAt, ar.ExecutedAt, ar.ErrorMessage,
      ar.ReviewNote,
      ru.UserName AS RequestedByName,
      rv.UserName AS ReviewedByName
    FROM dbo.TblApprovalRequests ar
    LEFT JOIN dbo.TblUser ru ON ru.UserID = ar.RequestedByUserID
    LEFT JOIN dbo.TblUser rv ON rv.UserID = ar.ReviewedByUserID
    ${whereClause}
    ORDER BY ar.CreatedAt DESC
  `);

  // Summary counts
  const counts = await (await getPool()).request().query(`
    SELECT Status, COUNT(*) AS Cnt FROM dbo.TblApprovalRequests GROUP BY Status
  `);
  const summary: Record<string, number> = {};
  for (const row of counts.recordset) summary[row.Status] = row.Cnt;

  return NextResponse.json({ requests: result.recordset, summary });
}
