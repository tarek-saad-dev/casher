/**
 * Booking Phase 7C1 — CORS policy / normalization / preflight / security tests.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

import {
  normalizePublicBookingOrigin,
  parsePublicBookingAllowedOrigins,
  getPublicBookingAllowedOrigins,
  resolvePublicBookingCorsPolicy,
  buildPublicBookingCorsHeaders,
  publicBookingOptionsResponse,
  publicBookingJson,
  resetPublicBookingCorsCacheForTests,
  PUBLIC_BOOKING_ROUTE_CORS,
  PUBLIC_BOOKING_CORS_MAX_AGE_SECONDS,
} from '@/lib/booking/publicBookingCors';
import { PUBLIC_BOOKING_ERROR_CATALOG } from '@/lib/booking/publicBookingErrorCatalog';
import { classifyProxyAuth, isAdminApiPath } from '@/lib/proxyPublicRoutes';

const root = path.join(__dirname, '..', '..', '..');
function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

beforeEach(() => {
  resetPublicBookingCorsCacheForTests();
});

describe('bookingPublicCorsNormalization', () => {
  it('normalizes trailing slash and rejects path/query/evil suffixes', () => {
    expect(normalizePublicBookingOrigin('https://cutsaloon.com/')).toBe(
      'https://cutsaloon.com',
    );
    expect(normalizePublicBookingOrigin('https://cutsaloon.com')).toBe(
      'https://cutsaloon.com',
    );
    expect(normalizePublicBookingOrigin('https://cutsaloon.com/path')).toBeNull();
    expect(normalizePublicBookingOrigin('https://cutsaloon.com?x=1')).toBeNull();
    expect(normalizePublicBookingOrigin('https://evilcutsaloon.com')).toBe(
      'https://evilcutsaloon.com',
    );
    expect(normalizePublicBookingOrigin('https://cutsaloon.com.evil.com')).toBe(
      'https://cutsaloon.com.evil.com',
    );
    expect(normalizePublicBookingOrigin('http://cutsaloon.com')).toBe('http://cutsaloon.com');
    expect(normalizePublicBookingOrigin('https://cutsaloon.com:444')).toBe(
      'https://cutsaloon.com:444',
    );
    expect(normalizePublicBookingOrigin('*')).toBeNull();
    expect(normalizePublicBookingOrigin('*.cutsaloon.com')).toBeNull();
  });

  it('parses comma allowlist with exact equality only', () => {
    const list = parsePublicBookingAllowedOrigins(
      ' https://cutsaloon.com/ , https://cutsaloon.com, https://evilcutsaloon.com ',
    );
    expect(list).toEqual(['https://cutsaloon.com', 'https://evilcutsaloon.com']);
    expect(list.includes('https://cutsaloon.com')).toBe(true);
    expect(list.includes('http://cutsaloon.com')).toBe(false);
  });
});

describe('bookingPublicCorsPolicy', () => {
  it('production empty env → no browser origins; no wildcard', () => {
    const r = getPublicBookingAllowedOrigins({
      NODE_ENV: 'production',
      PUBLIC_BOOKING_ALLOWED_ORIGINS: '',
    });
    expect(r.origins).toEqual([]);
    expect(r.source).toBe('empty');
  });

  it('dev empty env → localhost defaults', () => {
    const r = getPublicBookingAllowedOrigins({
      NODE_ENV: 'development',
      PUBLIC_BOOKING_ALLOWED_ORIGINS: '',
    });
    expect(r.source).toBe('dev_default');
    expect(r.origins).toContain('http://localhost:3000');
  });

  it('env origins win; http vs https distinct', () => {
    const env = {
      NODE_ENV: 'production' as const,
      PUBLIC_BOOKING_ALLOWED_ORIGINS: 'https://cutsaloon.com',
    };
    expect(
      resolvePublicBookingCorsPolicy({
        requestOrigin: 'https://cutsaloon.com',
        environment: env,
      }).kind,
    ).toBe('allowed');
    expect(
      resolvePublicBookingCorsPolicy({
        requestOrigin: 'http://cutsaloon.com',
        environment: env,
      }).kind,
    ).toBe('disallowed');
    expect(
      resolvePublicBookingCorsPolicy({
        requestOrigin: 'https://evilcutsaloon.com',
        environment: env,
      }).kind,
    ).toBe('disallowed');
    expect(
      resolvePublicBookingCorsPolicy({
        requestOrigin: 'https://cutsaloon.com.evil.com',
        environment: env,
      }).kind,
    ).toBe('disallowed');
  });

  it('missing Origin allowed; Origin null rejected', () => {
    expect(
      resolvePublicBookingCorsPolicy({ requestOrigin: null }).kind,
    ).toBe('no_origin');
    expect(
      resolvePublicBookingCorsPolicy({ requestOrigin: undefined }).kind,
    ).toBe('no_origin');
    expect(
      resolvePublicBookingCorsPolicy({ requestOrigin: 'null' }).kind,
    ).toBe('disallowed');
  });

  it('dev origins not auto-allowed in production', () => {
    const env = { NODE_ENV: 'production' as const, PUBLIC_BOOKING_ALLOWED_ORIGINS: '' };
    expect(
      resolvePublicBookingCorsPolicy({
        requestOrigin: 'http://localhost:3000',
        environment: env,
      }).kind,
    ).toBe('disallowed');
  });
});

describe('bookingPublicCorsPreflight', () => {
  it('allowed OPTIONS → 204 exact ACAO + Idempotency-Key + Max-Age', async () => {
    const env = {
      NODE_ENV: 'production',
      PUBLIC_BOOKING_ALLOWED_ORIGINS: 'https://cutsaloon.com',
    };
    const req = new NextRequest('https://api.example/api/public/booking/create', {
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
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://cutsaloon.com');
    expect(res.headers.get('Vary')).toContain('Origin');
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Idempotency-Key');
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
    expect(res.headers.get('Access-Control-Max-Age')).toBe(
      String(PUBLIC_BOOKING_CORS_MAX_AGE_SECONDS),
    );
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });

  it('disallowed OPTIONS → 403 without ACAO', () => {
    const env = {
      NODE_ENV: 'production',
      PUBLIC_BOOKING_ALLOWED_ORIGINS: 'https://cutsaloon.com',
    };
    const req = new NextRequest('https://api.example/api/public/booking/create', {
      method: 'OPTIONS',
      headers: { Origin: 'https://example.com' },
    });
    const res = publicBookingOptionsResponse({
      request: req,
      allowedMethods: ['POST', 'OPTIONS'],
      environment: env,
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(res.headers.get('Vary')).toContain('Origin');
  });
});

describe('bookingPublicCorsErrors / rate limit', () => {
  it('allowed origin gets ACAO on JSON and 429', () => {
    const env = {
      NODE_ENV: 'production',
      PUBLIC_BOOKING_ALLOWED_ORIGINS: 'https://cutsaloon.com',
    };
    const req = new NextRequest('https://api.example/api/public/booking/services', {
      method: 'GET',
      headers: { Origin: 'https://cutsaloon.com' },
    });
    const ok = publicBookingJson(
      req,
      { ok: false, error: { code: 'BRANCH_REQUIRED' } },
      {
        status: 400,
        allowedMethods: ['GET', 'OPTIONS'],
        environment: env,
      },
    );
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('https://cutsaloon.com');
    expect(ok.headers.get('Vary')).toContain('Origin');

    const limitedEnv = publicBookingJson(
      req,
      { ok: false, error: { code: 'RATE_LIMITED' } },
      { status: 429, allowedMethods: ['GET', 'OPTIONS'], environment: env },
    );
    expect(limitedEnv.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://cutsaloon.com',
    );
  });

  it('disallowed origin GET succeeds without ACAO; no allowlist leak', () => {
    const env = {
      NODE_ENV: 'production',
      PUBLIC_BOOKING_ALLOWED_ORIGINS: 'https://cutsaloon.com',
    };
    const req = new NextRequest('https://api.example/api/public/branches', {
      method: 'GET',
      headers: { Origin: 'https://example.com' },
    });
    const res = publicBookingJson(
      req,
      { ok: true, branches: [] },
      { allowedMethods: ['GET', 'OPTIONS'], environment: env },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(JSON.stringify(res)).not.toContain('cutsaloon.com');
  });

  it('no-Origin continues without ACAO', () => {
    const env = {
      NODE_ENV: 'production',
      PUBLIC_BOOKING_ALLOWED_ORIGINS: 'https://cutsaloon.com',
    };
    const req = new NextRequest('https://api.example/api/public/branches', {
      method: 'GET',
    });
    const res = publicBookingJson(
      req,
      { ok: true },
      { allowedMethods: ['GET', 'OPTIONS'], environment: env },
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('error catalog includes CORS_ORIGIN_NOT_ALLOWED', () => {
    expect(PUBLIC_BOOKING_ERROR_CATALOG.CORS_ORIGIN_NOT_ALLOWED.code).toBe(
      'CORS_ORIGIN_NOT_ALLOWED',
    );
  });
});

describe('bookingPublicCorsProxy', () => {
  it('public booking paths anonymous; admin protected', () => {
    expect(classifyProxyAuth('/api/public/booking/create').kind).toBe(
      'anonymous_public',
    );
    expect(classifyProxyAuth('/api/public/branches').kind).toBe('anonymous_public');
    expect(classifyProxyAuth('/api/admin/branches').kind).toBe('session_required');
    expect(isAdminApiPath('/api/admin/foo')).toBe(true);
  });
});

describe('bookingPublicCorsRouteMatrix / security', () => {
  it('every booking route family uses publicBookingCors (no PUBLIC_CORS_HEADERS)', () => {
    const files = [
      'src/app/api/public/branches/route.ts',
      'src/app/api/public/booking/config/route.ts',
      'src/app/api/public/booking/status/route.ts',
      'src/app/api/public/booking/services/route.ts',
      'src/app/api/public/booking/barbers/route.ts',
      'src/app/api/public/booking/barbers/[empId]/calendar/route.ts',
      'src/app/api/public/booking/barbers/[empId]/location/route.ts',
      'src/app/api/public/booking/barbers/[empId]/available-slots/route.ts',
      'src/app/api/public/booking/available-days/route.ts',
      'src/app/api/public/booking/available-slots/route.ts',
      'src/app/api/public/booking/check-slot/route.ts',
      'src/app/api/public/booking/plan/route.ts',
      'src/app/api/public/booking/create/route.ts',
      'src/app/api/public/booking/[code]/route.ts',
      'src/app/api/public/booking/upcoming/route.ts',
      'src/app/api/public/booking/cancel/route.ts',
      'src/app/api/public/booking/[code]/cancel/route.ts',
    ];
    for (const f of files) {
      const src = read(f);
      expect(src).toContain('publicBookingOptionsResponse');
      expect(src).toContain('PUBLIC_BOOKING_ROUTE_CORS');
      expect(src).not.toContain('PUBLIC_CORS_HEADERS');
      expect(src).not.toContain('Access-Control-Allow-Origin": "*"');
    }
  });

  it('create/cancel advertise Idempotency-Key; lookup advertises Authorization', () => {
    expect(PUBLIC_BOOKING_ROUTE_CORS.create.headers).toContain('Idempotency-Key');
    expect(PUBLIC_BOOKING_ROUTE_CORS.cancel.headers).toContain('Idempotency-Key');
    expect(PUBLIC_BOOKING_ROUTE_CORS.lookup.headers).toContain('Authorization');
    expect(PUBLIC_BOOKING_ROUTE_CORS.services.methods).toEqual(['GET', 'OPTIONS']);
    expect(PUBLIC_BOOKING_ROUTE_CORS.create.methods).toEqual(['POST', 'OPTIONS']);
  });

  it('build headers never sets credentials or wildcard', () => {
    const h = buildPublicBookingCorsHeaders({
      requestOrigin: 'https://cutsaloon.com',
      allowedMethods: ['GET', 'OPTIONS'],
      environment: {
        NODE_ENV: 'production',
        PUBLIC_BOOKING_ALLOWED_ORIGINS: 'https://cutsaloon.com',
      },
    });
    expect(h['Access-Control-Allow-Origin']).toBe('https://cutsaloon.com');
    expect(h['Access-Control-Allow-Credentials']).toBeUndefined();
    expect(Object.values(h).join(' ')).not.toContain('*');
  });
});
