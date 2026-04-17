import { NextRequest, NextResponse } from 'next/server';

const COOKIE_NAME = 'pos_session';

// Public routes that don't require authentication
const PUBLIC_ROUTES = ['/login', '/api/auth/login'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public routes
  if (PUBLIC_ROUTES.some((r) => pathname.startsWith(r))) {
    return NextResponse.next();
  }

  // Allow static assets and Next.js internals
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // Check session cookie exists
  const session = req.cookies.get(COOKIE_NAME);
  if (!session?.value) {
    // API routes return 401, page routes redirect to login
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'غير مصرح — يجب تسجيل الدخول' }, { status: 401 });
    }
    const loginUrl = new URL('/login', req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
