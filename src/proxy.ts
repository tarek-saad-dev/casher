import { NextRequest, NextResponse } from 'next/server';
import {
  classifyProxyAuth,
  isCronBearerAuthorized,
} from '@/lib/proxyPublicRoutes';

const COOKIE_NAME = 'pos_session';

/**
 * Edge proxy — defense-in-depth session gate.
 * Route handlers remain authoritative for authorization.
 *
 * Public surface is an explicit allowlist (see proxyPublicRoutes.ts).
 * `/api/admin/` is NOT public.
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const classification = classifyProxyAuth(pathname);

  if (classification.kind === 'static') {
    return NextResponse.next();
  }

  if (classification.kind === 'anonymous_public') {
    return NextResponse.next();
  }

  if (classification.kind === 'cron_bearer') {
    const hasSession = Boolean(req.cookies.get(COOKIE_NAME)?.value);
    if (hasSession || isCronBearerAuthorized(req.headers.get('authorization'))) {
      return NextResponse.next();
    }
    return NextResponse.json(
      { error: 'غير مصرح — CRON_SECRET مطلوب (Bearer)' },
      { status: 401 },
    );
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
