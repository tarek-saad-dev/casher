import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getPool, getUserFriendlyError, sql } from '@/lib/db';
import { createSession } from '@/lib/session';
import { getUserAccess } from '@/lib/permissions-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type LoginBody = {
  loginName?: string;
  password?: string;
};

function logStep(requestId: string, step: string, detail?: Record<string, unknown>) {
  if (detail) {
    console.info(`[auth/login:${requestId}] ${step}`, detail);
    return;
  }
  console.info(`[auth/login:${requestId}] ${step}`);
}

async function parseLoginBody(req: NextRequest, requestId: string): Promise<LoginBody | NextResponse> {
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    logStep(requestId, 'reject:invalid-content-type', { contentType });
    return NextResponse.json(
      { error: 'نوع الطلب غير صالح — يجب إرسال JSON', code: 'INVALID_CONTENT_TYPE' },
      { status: 415 },
    );
  }

  try {
    const body = (await req.json()) as LoginBody;
    return body;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid JSON';
    logStep(requestId, 'reject:invalid-json', { message });
    return NextResponse.json(
      { error: 'صيغة الطلب غير صالحة', code: 'INVALID_JSON' },
      { status: 400 },
    );
  }
}

// GET /api/auth/login — health check (verifies route is registered)
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: '/api/auth/login',
    methods: ['GET', 'POST'],
  });
}

// POST /api/auth/login
export async function POST(req: NextRequest) {
  const requestId = randomUUID().slice(0, 8);
  const startedAt = Date.now();
  logStep(requestId, 'start');

  try {
    const body = await parseLoginBody(req, requestId);
    if (body instanceof NextResponse) return body;

    const loginName = body.loginName?.trim() ?? '';
    const password = body.password?.trim() ?? '';

    if (!loginName || !password) {
      logStep(requestId, 'reject:missing-credentials');
      return NextResponse.json(
        { error: 'يجب إدخال اسم المستخدم وكلمة المرور', code: 'MISSING_CREDENTIALS' },
        { status: 400 },
      );
    }

    logStep(requestId, 'db:connect');
    const db = await getPool();

    logStep(requestId, 'db:lookup-user', { loginName });
    const result = await db
      .request()
      .input('loginName', sql.NVarChar(50), loginName)
      .input('password', sql.NVarChar(50), password)
      .query(`
        SELECT UserID, UserName, UserLevel, loginName, ShiftID
        FROM [dbo].[TblUser]
        WHERE loginName = @loginName
          AND Password = @password
          AND isDeleted = 0
      `);

    if (result.recordset.length === 0) {
      logStep(requestId, 'reject:invalid-credentials', { loginName });
      return NextResponse.json(
        { error: 'اسم المستخدم أو كلمة المرور غير صحيحة', code: 'INVALID_CREDENTIALS' },
        { status: 401 },
      );
    }

    const user = result.recordset[0];
    logStep(requestId, 'session:create', { userId: user.UserID, userName: user.UserName });

    await createSession({
      UserID: user.UserID,
      UserName: user.UserName,
      UserLevel: user.UserLevel,
    });

    let redirectTo = '/income/pos';
    let skipShiftPrompt = false;

    try {
      logStep(requestId, 'permissions:load', { userId: user.UserID });
      const access = await getUserAccess(user.UserID, user.UserName, user.UserLevel);
      redirectTo = access.defaultLandingPath;
      skipShiftPrompt = access.isPartnerOnly;
    } catch (permErr: unknown) {
      const message = permErr instanceof Error ? permErr.message : 'Unknown permissions error';
      logStep(requestId, 'permissions:fallback', { message });
    }

    logStep(requestId, 'success', {
      userId: user.UserID,
      userName: user.UserName,
      level: user.UserLevel,
      redirectTo,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({
      UserID: user.UserID,
      UserName: user.UserName,
      UserLevel: user.UserLevel,
      ShiftID: user.ShiftID,
      redirectTo,
      skipShiftPrompt,
    });
  } catch (err: unknown) {
    const rawMessage = err instanceof Error ? err.message : 'Unknown error';
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(`[auth/login:${requestId}] error`, { message: rawMessage, stack, durationMs: Date.now() - startedAt });
    const userMessage = getUserFriendlyError(err);
    return NextResponse.json(
      { error: userMessage, code: 'LOGIN_FAILED', requestId },
      { status: 500 },
    );
  }
}
