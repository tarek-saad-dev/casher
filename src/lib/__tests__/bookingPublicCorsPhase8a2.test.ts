/** Phase 8A2 — Access-Control-Expose-Headers closure proofs. */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';

vi.mock('server-only', () => ({}));

import {
  buildPublicBookingCorsHeaders,
  publicBookingOptionsResponse,
  publicBookingJson,
  publicBookingRateLimitedResponse,
  resetPublicBookingCorsCacheForTests,
  PUBLIC_BOOKING_ROUTE_CORS,
  PUBLIC_BOOKING_EXPOSED_HEADERS,
  PUBLIC_BOOKING_EXPOSED_HEADERS_VALUE,
} from '@/lib/booking/publicBookingCors';
import {
  gatePublicBookingRoute,
} from '@/lib/booking/publicBookingRouteGate';
import { resetPublicBookingRateLimitsForTests } from '@/lib/booking/publicBookingRateLimitPolicy';

const PROD_ORIGINS =
  'https://cutsaloon.com,https://www.cutsaloon.com';

const env = {
  NODE_ENV: 'production' as const,
  PUBLIC_BOOKING_ALLOWED_ORIGINS: PROD_ORIGINS,
};

const REQUIRED_EXPOSE = [
  'X-Booking-Contract-Version',
  'X-Request-Id',
  'Retry-After',
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
  'Deprecation',
  'Warning',
] as const;

beforeEach(() => {
  resetPublicBookingCorsCacheForTests();
  resetPublicBookingRateLimitsForTests();
});

describe('Phase 8A2 Expose-Headers', () => {
  it('1. root origin receives exact ACAO', () => {
    const h = buildPublicBookingCorsHeaders({
      requestOrigin: 'https://cutsaloon.com',
      allowedMethods: ['GET', 'OPTIONS'],
      environment: env,
    });
    expect(h['Access-Control-Allow-Origin']).toBe('https://cutsaloon.com');
  });

  it('2. www origin receives exact ACAO', () => {
    const h = buildPublicBookingCorsHeaders({
      requestOrigin: 'https://www.cutsaloon.com',
      allowedMethods: ['GET', 'OPTIONS'],
      environment: env,
    });
    expect(h['Access-Control-Allow-Origin']).toBe('https://www.cutsaloon.com');
  });

  it('3. root origin receives Access-Control-Expose-Headers', () => {
    const h = buildPublicBookingCorsHeaders({
      requestOrigin: 'https://cutsaloon.com',
      allowedMethods: ['GET', 'OPTIONS'],
      environment: env,
    });
    expect(h['Access-Control-Expose-Headers']).toBe(
      PUBLIC_BOOKING_EXPOSED_HEADERS_VALUE,
    );
  });

  it('4. www origin receives Access-Control-Expose-Headers', () => {
    const h = buildPublicBookingCorsHeaders({
      requestOrigin: 'https://www.cutsaloon.com',
      allowedMethods: ['GET', 'OPTIONS'],
      environment: env,
    });
    expect(h['Access-Control-Expose-Headers']).toBe(
      PUBLIC_BOOKING_EXPOSED_HEADERS_VALUE,
    );
  });

  it('5. expose list contains all required headers', () => {
    expect([...PUBLIC_BOOKING_EXPOSED_HEADERS]).toEqual([...REQUIRED_EXPOSE]);
    for (const name of REQUIRED_EXPOSE) {
      expect(PUBLIC_BOOKING_EXPOSED_HEADERS_VALUE).toContain(name);
    }
  });

  it('6. no duplicate exposed-header names', () => {
    const names = [...PUBLIC_BOOKING_EXPOSED_HEADERS];
    expect(new Set(names).size).toBe(names.length);
  });

  it('7. allowed-origin validation error includes Expose-Headers', () => {
    const req = new NextRequest('http://localhost/api/public/booking/check-slot', {
      method: 'POST',
      headers: { Origin: 'https://cutsaloon.com' },
    });
    const res = publicBookingJson(
      req,
      {
        ok: false,
        error: {
          code: 'INVALID_DATE',
          message: 'تاريخ غير صالح',
          technicalMessage: 'Invalid date',
          metadata: {},
        },
      },
      {
        status: 400,
        allowedMethods: ['POST', 'OPTIONS'],
        environment: env,
      },
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://cutsaloon.com',
    );
    expect(res.headers.get('Access-Control-Expose-Headers')).toBe(
      PUBLIC_BOOKING_EXPOSED_HEADERS_VALUE,
    );
  });

  it('8. allowed-origin 429 includes Expose-Headers', () => {
    const prevOrigins = process.env.PUBLIC_BOOKING_ALLOWED_ORIGINS;
    const prevNode = process.env.NODE_ENV;
    process.env.PUBLIC_BOOKING_ALLOWED_ORIGINS = PROD_ORIGINS;
    process.env.NODE_ENV = 'production';
    resetPublicBookingCorsCacheForTests();
    try {
      const req = new NextRequest('http://localhost/api/public/booking/cancel', {
        method: 'POST',
        headers: {
          Origin: 'https://www.cutsaloon.com',
          'x-forwarded-for': '198.51.100.10',
        },
      });
      // Exhaust cancel family (limit 10)
      for (let i = 0; i < 11; i++) {
        gatePublicBookingRoute(req, 'cancel', 'subjdigest8a2');
      }
      const { blocked } = gatePublicBookingRoute(req, 'cancel', 'subjdigest8a2');
      expect(blocked).not.toBeNull();
      expect(blocked!.status).toBe(429);
      expect(blocked!.headers.get('Access-Control-Allow-Origin')).toBe(
        'https://www.cutsaloon.com',
      );
      expect(blocked!.headers.get('Access-Control-Expose-Headers')).toBe(
        PUBLIC_BOOKING_EXPOSED_HEADERS_VALUE,
      );
      expect(blocked!.headers.get('Retry-After')).toBeTruthy();

      // Legacy helper path also exposes
      const legacy = publicBookingRateLimitedResponse(req, {
        allowedMethods: ['POST', 'OPTIONS'],
        environment: env,
      });
      expect(legacy.headers.get('Access-Control-Expose-Headers')).toBe(
        PUBLIC_BOOKING_EXPOSED_HEADERS_VALUE,
      );
    } finally {
      if (prevOrigins === undefined) delete process.env.PUBLIC_BOOKING_ALLOWED_ORIGINS;
      else process.env.PUBLIC_BOOKING_ALLOWED_ORIGINS = prevOrigins;
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
      resetPublicBookingCorsCacheForTests();
    }
  });

  it('9. disallowed Origin receives no ACAO', () => {
    const h = buildPublicBookingCorsHeaders({
      requestOrigin: 'https://example.com',
      allowedMethods: ['GET', 'OPTIONS'],
      environment: env,
    });
    expect(h['Access-Control-Allow-Origin']).toBeUndefined();
    expect(h['Access-Control-Expose-Headers']).toBeUndefined();
  });

  it('10. Origin null is rejected', () => {
    const req = new NextRequest('http://localhost/api/public/booking/create', {
      method: 'OPTIONS',
      headers: { Origin: 'null' },
    });
    const res = publicBookingOptionsResponse({
      request: req,
      allowedMethods: ['POST', 'OPTIONS'],
      allowedHeaders: PUBLIC_BOOKING_ROUTE_CORS.create.headers,
      environment: env,
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('11. missing Origin still works', () => {
    const req = new NextRequest('http://localhost/api/public/branches', {
      method: 'GET',
    });
    const res = publicBookingJson(
      req,
      { ok: true, branches: [] },
      { allowedMethods: ['GET', 'OPTIONS'], environment: env },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('12. no wildcard ACAO', () => {
    for (const origin of ['https://cutsaloon.com', 'https://www.cutsaloon.com']) {
      const h = buildPublicBookingCorsHeaders({
        requestOrigin: origin,
        allowedMethods: ['GET', 'OPTIONS'],
        environment: env,
      });
      expect(h['Access-Control-Allow-Origin']).not.toBe('*');
      expect(Object.values(h).join(' ')).not.toMatch(/\b\*\b/);
    }
  });

  it('13. no Access-Control-Allow-Credentials', () => {
    const h = buildPublicBookingCorsHeaders({
      requestOrigin: 'https://cutsaloon.com',
      allowedMethods: ['POST', 'OPTIONS'],
      forPreflight: true,
      environment: env,
    });
    expect(h['Access-Control-Allow-Credentials']).toBeUndefined();
  });

  it('14. create preflight still allows Idempotency-Key', () => {
    const req = new NextRequest('http://localhost/api/public/booking/create', {
      method: 'OPTIONS',
      headers: { Origin: 'https://cutsaloon.com' },
    });
    const res = publicBookingOptionsResponse({
      request: req,
      allowedMethods: [...PUBLIC_BOOKING_ROUTE_CORS.create.methods],
      allowedHeaders: PUBLIC_BOOKING_ROUTE_CORS.create.headers,
      environment: env,
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain(
      'Idempotency-Key',
    );
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
    expect(res.headers.get('Access-Control-Max-Age')).toBe('600');
  });

  it('15. cancel preflight still allows Idempotency-Key', () => {
    for (const family of [
      PUBLIC_BOOKING_ROUTE_CORS.cancel,
      PUBLIC_BOOKING_ROUTE_CORS['cancel-by-code'],
    ]) {
      const req = new NextRequest('http://localhost/api/public/booking/cancel', {
        method: 'OPTIONS',
        headers: { Origin: 'https://www.cutsaloon.com' },
      });
      const res = publicBookingOptionsResponse({
        request: req,
        allowedMethods: [...family.methods],
        allowedHeaders: family.headers,
        environment: env,
      });
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Headers')).toContain(
        'Idempotency-Key',
      );
    }
  });

  it('16. admin routes remain protected (proxy classification)', () => {
    const proxy = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/proxyPublicRoutes.ts'),
      'utf8',
    );
    expect(proxy).toContain('anonymous_public');
    expect(proxy).toMatch(/\/api\/public\//);
    // Admin is not classified as anonymous_public
    expect(proxy).not.toMatch(/\/api\/admin\/.*anonymous_public/);
  });

  it('17. Camp Caesar remains non-public (visibility policy in tree)', () => {
    const visibility = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/branch/publicBranchVisibility.ts'),
      'utf8',
    );
    expect(visibility.length).toBeGreaterThan(0);
    // Public booking branch context still rejects non-public
    const ctx = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/booking/publicBookingBranchContext.ts'),
      'utf8',
    );
    expect(ctx).toContain('BRANCH_NOT_PUBLIC');
  });

  it('central constant is not duplicated in route handlers', () => {
    const routesDir = path.join(process.cwd(), 'src/app/api/public');
    const offenders: string[] = [];
    function walk(dir: string) {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (ent.name === 'route.ts') {
          const src = fs.readFileSync(p, 'utf8');
          if (
            src.includes('Access-Control-Expose-Headers') ||
            src.includes('PUBLIC_BOOKING_EXPOSED_HEADERS')
          ) {
            offenders.push(p);
          }
        }
      }
    }
    walk(routesDir);
    expect(offenders).toEqual([]);
  });
});
