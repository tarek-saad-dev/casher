import { NextRequest, NextResponse } from 'next/server';
import {
  classifyProxyAuth,
  isCronBearerAuthorized,
  isWhatsAppInboxWebhookAuthorized,
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
  const classification = classifyProxyAuth(pathname);

  if (classification.kind === 'static') {
    return NextResponse.next();
  }

  if (classification.kind === 'anonymous_public') {
    return nextWithPathname(req, pathname);
  }

  if (classification.kind === 'whatsapp_inbox_webhook') {
    const hasSession = Boolean(req.cookies.get(COOKIE_NAME)?.value);
    if (hasSession || isWhatsAppInboxWebhookAuthorized(req.headers.get('authorization'))) {
      return nextWithPathname(req, pathname);
    }
    return NextResponse.json(
      { error: 'غير مصرح — WHATSAPP_INBOX_WEBHOOK_TOKEN مطلوب (Bearer)' },
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
