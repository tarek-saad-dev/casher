import { NextRequest, NextResponse } from "next/server";
import { getPool, getUserFriendlyError, sql } from "@/lib/db";
import { createSession } from "@/lib/session";

export const runtime = "nodejs";

// POST /api/auth/login
export async function POST(req: NextRequest) {
  try {
    const { loginName, password } = await req.json();

    if (!loginName || !password) {
      return NextResponse.json(
        { error: "يجب إدخال اسم المستخدم وكلمة المرور" },
        { status: 400 },
      );
    }

    const db = await getPool();
    const result = await db
      .request()
      .input("loginName", sql.NVarChar(50), loginName)
      .input("password", sql.NVarChar(50), password).query(`
        SELECT UserID, UserName, UserLevel, loginName, ShiftID
        FROM [dbo].[TblUser]
        WHERE loginName = @loginName
          AND Password = @password
          AND isDeleted = 0
      `);

    if (result.recordset.length === 0) {
      return NextResponse.json(
        { error: "اسم المستخدم أو كلمة المرور غير صحيحة" },
        { status: 401 },
      );
    }

    const user = result.recordset[0];
    await createSession({
      UserID: user.UserID,
      UserName: user.UserName,
      UserLevel: user.UserLevel,
    });

    console.log(
      `[auth] Login success: UserID=${user.UserID}, UserName=${user.UserName}, Level=${user.UserLevel}`,
    );

    return NextResponse.json({
      UserID: user.UserID,
      UserName: user.UserName,
      UserLevel: user.UserLevel,
      ShiftID: user.ShiftID,
    });
  } catch (err: unknown) {
    const rawMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[auth/login] error:", rawMessage);
    const userMessage = getUserFriendlyError(err);
    return NextResponse.json({ error: userMessage }, { status: 500 });
  }
}
