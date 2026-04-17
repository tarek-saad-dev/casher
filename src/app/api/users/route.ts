import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';

// GET /api/users — Get all active users
export async function GET() {
  try {
    const user = await getSession();
    if (!user || !hasPermission(user.UserLevel, 'users.view')) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
    }

    const db = await getPool();
    const result = await db.request().query(`
      SELECT u.UserID, u.UserName, u.UserLevel, u.loginName, u.ShiftID, u.CardNO,
             s.ShiftName
      FROM [dbo].[TblUser] u
      LEFT JOIN [dbo].[TblShift] s ON u.ShiftID = s.ShiftID
      WHERE u.isDeleted = 0
      ORDER BY u.UserID
    `);
    return NextResponse.json(result.recordset);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/users] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/users — Create a new user
export async function POST(req: NextRequest) {
  try {
    const sessionUser = await getSession();
    if (!sessionUser || !hasPermission(sessionUser.UserLevel, 'users.create')) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
    }

    const body = await req.json();
    const { UserName, loginName, Password, UserLevel, ShiftID } = body;

    if (!UserName || !loginName || !Password) {
      return NextResponse.json({ error: 'يجب إدخال جميع البيانات المطلوبة' }, { status: 400 });
    }

    const db = await getPool();

    // Check duplicate loginName
    const dup = await db.request()
      .input('loginName', sql.NVarChar(50), loginName)
      .query(`SELECT UserID FROM [dbo].[TblUser] WHERE loginName = @loginName AND isDeleted = 0`);
    if (dup.recordset.length > 0) {
      return NextResponse.json({ error: 'اسم الدخول مستخدم بالفعل' }, { status: 400 });
    }

    const result = await db.request()
      .input('UserName', sql.NVarChar(50), UserName)
      .input('loginName', sql.NVarChar(50), loginName)
      .input('Password', sql.NVarChar(50), Password)
      .input('UserLevel', sql.NVarChar(20), UserLevel || 'user')
      .input('ShiftID', sql.Int, ShiftID || 1)
      .input('CardNO', sql.NVarChar(50), '')
      .query(`
        INSERT INTO [dbo].[TblUser] (UserName, loginName, Password, UserLevel, ShiftID, CardNO, isDeleted)
        OUTPUT INSERTED.UserID, INSERTED.UserName, INSERTED.loginName, INSERTED.UserLevel, INSERTED.ShiftID
        VALUES (@UserName, @loginName, @Password, @UserLevel, @ShiftID, @CardNO, 0)
      `);

    console.log(`[users] Created user: ${result.recordset[0].UserName} by ${sessionUser.UserName}`);
    return NextResponse.json(result.recordset[0], { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/users] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
