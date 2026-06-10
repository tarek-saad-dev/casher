import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import sql from 'mssql';
import { getSession } from '@/lib/session';
import { getUserAccess } from '@/lib/permissions-server';

type Ctx = { params: Promise<{ id: string }> };

// GET /api/admin/approvals/:id
export async function GET(_req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

  const access = await getUserAccess(session.UserID, session.UserName, session.UserLevel);
  if (!access.isSuperAdmin) return NextResponse.json({ error: 'super_admin only' }, { status: 403 });

  const { id } = await params;
  const approvalId = parseInt(id);
  if (isNaN(approvalId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const db = await getPool();
  const result = await db.request()
    .input('id', sql.Int, approvalId)
    .query(`
      SELECT
        ar.*,
        ru.UserName AS RequestedByName,
        rv.UserName AS ReviewedByName
      FROM dbo.TblApprovalRequests ar
      LEFT JOIN dbo.TblUser ru ON ru.UserID = ar.RequestedByUserID
      LEFT JOIN dbo.TblUser rv ON rv.UserID = ar.ReviewedByUserID
      WHERE ar.ApprovalID = @id
    `);

  if (!result.recordset.length) return NextResponse.json({ error: 'غير موجود' }, { status: 404 });

  const row = result.recordset[0];
  return NextResponse.json({
    ...row,
    OldData: row.OldData ? JSON.parse(row.OldData) : null,
    NewData: row.NewData ? JSON.parse(row.NewData) : null,
  });
}
