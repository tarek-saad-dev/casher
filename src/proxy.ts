import { NextRequest, NextResponse } from 'next/server';
import {
  classifyProxyAuth,
  isCronBearerAuthorized,
  hasWebhookBearerToken,
} from '@/lib/proxyPublicRoutes';

const COOKIE_NAME = 'pos_session';

/**
 * Forward the request with `x-pathname` set by the proxy. Always overwritten so a client-sent
 * value never reaches route handlers (the DRVO-013 route-family app gate reads it).
 */
function nextWithPathname(req: NextRequest, pathname: string): NextResponse {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-pathname', pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

/**
 * Edge proxy — defense-in-depth session gate.
 * Route handlers remain authoritative for authorization.
 *
 * Public surface is an explicit allowlist (see proxyPublicRoutes.ts).
 * `/api/admin/` is NOT public.
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Staging preview is read-only until all outbound integration and background
  // worker paths are audited. This blocks public webhooks, cron invocations,
  // and API mutations even if a route is normally anonymous.
  // This is NOT a substitute for network-level outbound isolation.
  if (process.env.DRVO_STAGING_MODE === 'true') {
    if (
      process.env.DRVO_STAGING_OUTBOUND_DISABLED !== 'true' ||
      process.env.DRVO_STAGING_WORKERS_DISABLED !== 'true' ||
      process.env.DRVO_STAGING_CRON_DISABLED !== 'true' ||
      process.env.STAGING_SAFETY_ENFORCE !== 'true'
    ) {
      return NextResponse.json({ error: 'Staging safety configuration incomplete' }, { status: 503 });
    }
    // Staging permits only authentication and operational bootstrap against its
    // isolated database. All other APIs (including webhooks, cron and mutations)
    // remain fail-closed. Do not broaden this list without a route audit.
    const stagingApiAllowed =
      (pathname === '/api/auth/login' && ['GET', 'POST'].includes(req.method)) ||
      (pathname === '/api/auth/session' && ['GET', 'DELETE'].includes(req.method)) ||
      (pathname === '/api/operations/bootstrap' && req.method === 'GET') ||
      (pathname === '/api/drvo/pos/access' && req.method === 'GET') ||
      (pathname === '/api/drvo/pos/sales/recent' && req.method === 'GET') ||
      (pathname === '/api/drvo/pos/catalog' && req.method === 'GET') ||
      (pathname === '/api/drvo/pos/employees' && req.method === 'GET') ||
      (pathname === '/api/drvo/platform/subscriptions' && req.method === 'POST') ||
      (pathname === '/api/drvo/platform/tenants' && req.method === 'POST') ||
      (pathname === '/api/drvo/tenant/roles' && req.method === 'POST') ||
      (pathname === '/api/drvo/tenant/members' && req.method === 'POST') ||
      (pathname === '/api/drvo/tenant/branches' && req.method === 'POST');
    if ((pathname.startsWith('/api/') && !stagingApiAllowed) ||
        (!pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method))) {
      return NextResponse.json({ error: 'Staging preview API disabled until isolation is verified' }, { status: 503 });
    }
  }
  const classification = classifyProxyAuth(pathname);

  if (classification.kind === 'static') {
    return NextResponse.next();
  }

  if (classification.kind === 'anonymous_public') {
    return nextWithPathname(req, pathname);
  }

  if (classification.kind === 'whatsapp_inbox_webhook') {
    const hasSession = Boolean(req.cookies.get(COOKIE_NAME)?.value);
    if (hasSession || hasWebhookBearerToken(req.headers.get('authorization'))) {
      return nextWithPathname(req, pathname);
    }
    return NextResponse.json(
      { error: 'غير مصرح — رمز قناة واتساب مطلوب (Bearer)' },
      { status: 401 },
    );
  }

  if (classification.kind === 'cron_bearer') {
    const hasSession = Boolean(req.cookies.get(COOKIE_NAME)?.value);
    if (hasSession || isCronBearerAuthorized(req.headers.get('authorization'))) {
      return nextWithPathname(req, pathname);
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

  return nextWithPathname(req, pathname);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
