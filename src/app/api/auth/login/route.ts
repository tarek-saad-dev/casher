import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getPool, getUserFriendlyError } from '@/lib/db';
import {
  assertSessionSecretConfigured,
  createSession,
  SessionConfigError,
} from '@/lib/session';
import { getUserAccess } from '@/lib/permissions-server';
import { BranchDomainError, BRANCH_SESSION_VERSION } from '@/lib/branch/types';
import type { DbUser } from '@/lib/session-types';
import { resolveLoginDefaultBranch } from '@/lib/branch/access';
import { hashPassword, verifyPassword } from '@/lib/auth/passwordHash';
import { createLogger } from '@/lib/observability/logger';
import { captureException } from '@/lib/observability/errorTracking';
import {
  isTenantContextError,
  resolveStaffTenantContextForRequest,
  type StaffTenantContext,
} from '@/platform/tenant/tenantContext';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isBranchDomainError(err: unknown): err is BranchDomainError {
  if (err instanceof BranchDomainError) return true;
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: string }).name === 'BranchDomainError' &&
    typeof (err as { code?: unknown }).code === 'string' &&
    typeof (err as { message?: unknown }).message === 'string' &&
    typeof (err as { status?: unknown }).status === 'number'
  );
}

type LoginBody = {
  loginName?: string;
  password?: string;
};

function logStep(requestId: string, step: string, detail?: Record<string, unknown>) {
  const tenantId = typeof detail?.tenantId === 'string' ? detail.tenantId : null;
  createLogger({ scope: 'auth/login', requestId, tenantId }).info(step, detail);
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

type LoginCandidate = Pick<DbUser, 'UserID' | 'UserName' | 'UserLevel' | 'loginName' | 'ShiftID'> & {
  StoredPassword: string | null;
};

type VerifiedLoginUser = Omit<LoginCandidate, 'StoredPassword'> & {
  storedPassword: string;
  needsUpgrade: boolean;
};

async function findUserWithPassword(
  candidates: LoginCandidate[],
  password: string,
): Promise<VerifiedLoginUser | null> {
  for (const candidate of candidates) {
    const verification = await verifyPassword(password, candidate.StoredPassword);
    if (!verification.ok) continue;
    const { StoredPassword, ...user } = candidate;
    return { ...user, storedPassword: StoredPassword ?? '', needsUpgrade: verification.needsUpgrade };
  }
  return null;
}

/** Best effort: a failed upgrade must not block a valid login; the row is retried next login. */
async function upgradeLegacyPassword(
  db: Awaited<ReturnType<typeof getPool>>,
  user: VerifiedLoginUser,
  password: string,
  requestId: string,
) {
  try {
    const hashed = await hashPassword(password);
    await db
      .request()
      .input('userId', user.UserID)
      .input('hashed', hashed)
      .input('previous', user.storedPassword)
      .query(`
        UPDATE [dbo].[TblUser]
        SET Password = @hashed
        WHERE UserID = @userId AND Password = @previous
      `);
    logStep(requestId, 'password:upgraded', { userId: user.UserID });
  } catch (err: unknown) {
    logStep(requestId, 'password:upgrade-failed', {
      userId: user.UserID,
      message: err instanceof Error ? err.message : 'unknown',
    });
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
    try {
      assertSessionSecretConfigured();
    } catch (err: unknown) {
      if (err instanceof SessionConfigError) {
        logStep(requestId, 'reject:session-config', { code: err.code });
        return NextResponse.json(
          {
            error: 'إعداد الجلسة غير مكتمل على الخادم — يلزم ضبط SESSION_SECRET',
            code: err.code,
            requestId,
          },
          { status: 500 },
        );
      }
      throw err;
    }

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
    // Untyped inputs: msnodesqlv8 (isolated Windows auth) rejects tedious sql.NVarChar types.
    const result = await db
      .request()
      .input('loginName', loginName)
      .query(`
        SELECT UserID, UserName, UserLevel, loginName, ShiftID, Password AS StoredPassword
        FROM [dbo].[TblUser]
        WHERE loginName = @loginName
          AND ISNULL(isDeleted, 0) = 0
        ORDER BY UserID
      `);

    const user = await findUserWithPassword(result.recordset as LoginCandidate[], password);
    if (!user) {
      logStep(requestId, 'reject:invalid-credentials', { loginName });
      return NextResponse.json(
        { error: 'اسم المستخدم أو كلمة المرور غير صحيحة', code: 'INVALID_CREDENTIALS' },
        { status: 401 },
      );
    }

    if (user.needsUpgrade) {
      await upgradeLegacyPassword(db, user, password, requestId);
    }
    logStep(requestId, 'branch:resolve-default', { userId: user.UserID });

    let defaultAccess;
    try {
      defaultAccess = await resolveLoginDefaultBranch(user.UserID);
    } catch (err: unknown) {
      if (isBranchDomainError(err)) {
        logStep(requestId, 'reject:branch-access', { code: err.code });
        return NextResponse.json(
          { error: err.message, code: err.code },
          { status: err.status },
        );
      }
      throw err;
    }

    logStep(requestId, 'session:create', {
      userId: user.UserID,
      userName: user.UserName,
      branchId: defaultAccess.branchId,
      branchCode: defaultAccess.branchCode,
    });

    let tenant: StaffTenantContext;
    try {
      tenant = await resolveStaffTenantContextForRequest({
        userId: user.UserID,
        activeBranchId: defaultAccess.branchId,
        preferredTenantId: null,
      });
    } catch (err: unknown) {
      if (isTenantContextError(err)) {
        logStep(requestId, 'reject:tenant-context', { code: err.code, userId: user.UserID });
        return NextResponse.json(
          { error: 'تعذر تحديد حساب المنشأة لهذا المستخدم', code: 'TENANT_CONTEXT_REQUIRED' },
          { status: 403 },
        );
      }
      throw err;
    }

    await createSession({
      UserID: user.UserID,
      UserName: user.UserName,
      UserLevel: user.UserLevel,
      ActiveBranchID: defaultAccess.branchId,
      ActiveBranchCode: defaultAccess.branchCode,
      BranchSessionVersion: BRANCH_SESSION_VERSION,
      TenantId: tenant.tenantId,
      MembershipId: tenant.membershipId,
    });

    let redirectTo = '/income/pos';
    let skipShiftPrompt = false;
    let roles: string[] = [];
    let allowedPagePaths: string[] = [];

    try {
      logStep(requestId, 'permissions:load', { userId: user.UserID });
      const access = await getUserAccess(user.UserID, user.UserName, user.UserLevel);
      redirectTo = access.defaultLandingPath;
      skipShiftPrompt = access.isPartnerOnly;
      roles = access.roles;
      allowedPagePaths = access.allowedPagePaths;
    } catch (permErr: unknown) {
      const message = permErr instanceof Error ? permErr.message : 'Unknown permissions error';
      logStep(requestId, 'permissions:fallback', { message });
    }

    logStep(requestId, 'success', {
      tenantId: tenant.tenantId,
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
      ActiveBranchID: defaultAccess.branchId,
      ActiveBranchCode: defaultAccess.branchCode,
      ActiveBranchName: defaultAccess.branchName,
      BranchSessionVersion: BRANCH_SESSION_VERSION,
      roles,
      allowedPagePaths,
    });
  } catch (err: unknown) {
    captureException(err, { scope: 'auth/login', requestId }, { durationMs: Date.now() - startedAt });
    if (err instanceof SessionConfigError) {
      return NextResponse.json(
        {
          error: 'إعداد الجلسة غير مكتمل على الخادم — يلزم ضبط SESSION_SECRET',
          code: err.code,
          requestId,
        },
        { status: 500 },
      );
    }
    const userMessage = getUserFriendlyError(err);
    return NextResponse.json(
      { error: userMessage, code: 'LOGIN_FAILED', requestId },
      { status: 500 },
    );
  }
}
