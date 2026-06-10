import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import sql from 'mssql';
import { getSession } from '@/lib/session';

// GET /api/approvals/my-requests — returns current user's approval requests
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');

  const db = await getPool();
  const request = db.request().input('uid', sql.Int, session.UserID);

  let whereExtra = '';
  if (status) {
    whereExtra = ' AND ar.Status = @status';
    request.input('status', sql.NVarChar, status);
  }

  const result = await request.query(`
    SELECT
      ar.ApprovalID, ar.RequestType, ar.EntityType, ar.EntityID,
      ar.ActionMethod, ar.Status, ar.RiskLevel, ar.Reason,
      ar.CreatedAt, ar.ReviewedAt, ar.ExecutedAt,
      ar.ReviewNote,
      rv.UserName AS ReviewedByName
    FROM dbo.TblApprovalRequests ar
    LEFT JOIN dbo.TblUser rv ON rv.UserID = ar.ReviewedByUserID
    WHERE ar.RequestedByUserID = @uid${whereExtra}
    ORDER BY ar.CreatedAt DESC
  `);

  return NextResponse.json({ requests: result.recordset });
}
