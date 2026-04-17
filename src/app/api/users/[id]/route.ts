import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';

// GET /api/users/[id]
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const sessionUser = await getSession();
    if (!sessionUser || !hasPermission(sessionUser.UserLevel, 'users.view')) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
    }

    const { id } = await params;
    const db = await getPool();
    const result = await db.request()
      .input('id', sql.Int, parseInt(id))
      .query(`
        SELECT u.UserID, u.UserName, u.UserLevel, u.loginName, u.ShiftID, u.CardNO,
               s.ShiftName
        FROM [dbo].[TblUser] u
        LEFT JOIN [dbo].[TblShift] s ON u.ShiftID = s.ShiftID
        WHERE u.UserID = @id AND u.isDeleted = 0
      `);
    if (result.recordset.length === 0) {
      return NextResponse.json({ error: 'المستخدم غير موجود' }, { status: 404 });
    }
    return NextResponse.json(result.recordset[0]);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT /api/users/[id] — Update user
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const sessionUser = await getSession();
    if (!sessionUser || !hasPermission(sessionUser.UserLevel, 'users.edit')) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
    }

    const { id } = await params;
    const body = await req.json();
    const { UserName, loginName, Password, UserLevel, ShiftID } = body;

    const db = await getPool();
    const r = db.request().input('id', sql.Int, parseInt(id));

    const sets: string[] = [];
    if (UserName) { r.input('UserName', sql.NVarChar(50), UserName); sets.push('UserName = @UserName'); }
    if (loginName) { r.input('loginName', sql.NVarChar(50), loginName); sets.push('loginName = @loginName'); }
    if (Password) { r.input('Password', sql.NVarChar(50), Password); sets.push('Password = @Password'); }
    if (UserLevel) { r.input('UserLevel', sql.NVarChar(20), UserLevel); sets.push('UserLevel = @UserLevel'); }
    if (ShiftID) { r.input('ShiftID', sql.Int, ShiftID); sets.push('ShiftID = @ShiftID'); }

    if (sets.length === 0) {
      return NextResponse.json({ error: 'لا توجد بيانات للتحديث' }, { status: 400 });
    }

    await r.query(`UPDATE [dbo].[TblUser] SET ${sets.join(', ')} WHERE UserID = @id`);
    console.log(`[users] Updated UserID=${id} by ${sessionUser.UserName}`);

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/users/[id] — Soft-delete user
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const sessionUser = await getSession();
    if (!sessionUser || !hasPermission(sessionUser.UserLevel, 'users.delete')) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
    }

    const { id } = await params;
    const userID = parseInt(id);

    if (sessionUser.UserID === userID) {
      return NextResponse.json({ error: 'لا يمكنك حذف حسابك الحالي' }, { status: 400 });
    }

    const db = await getPool();
    await db.request()
      .input('id', sql.Int, userID)
      .query(`UPDATE [dbo].[TblUser] SET isDeleted = 1 WHERE UserID = @id`);

    console.log(`[users] Soft-deleted UserID=${userID} by ${sessionUser.UserName}`);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
