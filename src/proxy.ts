import { NextRequest, NextResponse } from 'next/server';

const COOKIE_NAME = 'pos_session';

// Public routes that don't require authentication
const PUBLIC_ROUTES = [
  '/login',
  '/api/auth/login',
  '/api/public/',
  '/api/admin/',
  '/api/cron/',
  '/api/payroll/daily/auto-generate',
  '/api/operations/flow-board',
];

/** Cron paths without session cookie still need Bearer CRON_SECRET (or "dev"). */
const CRON_BEARER_ROUTES = [
  '/api/cron/',
  '/api/admin/hr/nightly-close',
  '/api/payroll/daily/auto-generate',
];

function isCronBearerAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  if (!token) return false;
  if (secret) return token === secret;
  return token === 'dev';
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_ROUTES.some((r) => pathname.startsWith(r))) {
    // Cron stays public at edge, but still requires Bearer when no session cookie.
    if (
      CRON_BEARER_ROUTES.some((r) => pathname.startsWith(r)) &&
      !req.cookies.get(COOKIE_NAME)?.value &&
      !isCronBearerAuthorized(req)
    ) {
      return NextResponse.json(
        { error: 'غير مصرح — CRON_SECRET مطلوب (Bearer)' },
        { status: 401 },
      );
    }
    return NextResponse.next();
  }

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  const session = req.cookies.get(COOKIE_NAME);
  if (!session?.value) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'غير مصرح — يجب تسجيل الدخول' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', req.url));
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-pathname', pathname);

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
