/** Phase 8A1 — dual-origin + Expose-Headers CORS proofs. */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

import {
  buildPublicBookingCorsHeaders,
  publicBookingOptionsResponse,
  publicBookingJson,
  resetPublicBookingCorsCacheForTests,
  PUBLIC_BOOKING_ROUTE_CORS,
  PUBLIC_BOOKING_CORS_EXPOSE_HEADERS,
  PUBLIC_BOOKING_CORS_EXPOSE_HEADERS_VALUE,
} from '@/lib/booking/publicBookingCors';

const PROD_ORIGINS =
  'https://cutsaloon.com,https://www.cutsaloon.com';

const env = {
  NODE_ENV: 'production' as const,
  PUBLIC_BOOKING_ALLOWED_ORIGINS: PROD_ORIGINS,
};

beforeEach(() => resetPublicBookingCorsCacheForTests());

describe('Phase 8A1 dual origins + Expose-Headers', () => {
  it('echoes exact ACAO for root and www origins', () => {
    for (const origin of ['https://cutsaloon.com', 'https://www.cutsaloon.com']) {
      const h = buildPublicBookingCorsHeaders({
        requestOrigin: origin,
        allowedMethods: ['GET', 'OPTIONS'],
        environment: env,
      });
      expect(h['Access-Control-Allow-Origin']).toBe(origin);
      expect(h['Access-Control-Allow-Credentials']).toBeUndefined();
      expect(h['Access-Control-Allow-Origin']).not.toBe('*');
      expect(h.Vary).toContain('Origin');
    }
  });

  it('sets centralized Access-Control-Expose-Headers list', () => {
    const h = buildPublicBookingCorsHeaders({
      requestOrigin: 'https://cutsaloon.com',
      allowedMethods: ['GET', 'OPTIONS'],
      environment: env,
    });
    expect(h['Access-Control-Expose-Headers']).toBe(
      PUBLIC_BOOKING_CORS_EXPOSE_HEADERS_VALUE,
    );
    for (const name of PUBLIC_BOOKING_CORS_EXPOSE_HEADERS) {
      expect(h['Access-Control-Expose-Headers']).toContain(name);
    }
    expect(h['Access-Control-Expose-Headers']).not.toMatch(/token/i);
    expect(h['Access-Control-Expose-Headers']).not.toContain('Authorization');
  });

  it('create OPTIONS allows Idempotency-Key for both origins', () => {
    for (const origin of ['https://cutsaloon.com', 'https://www.cutsaloon.com']) {
      const req = new NextRequest('http://localhost/api/public/booking/create', {
        method: 'OPTIONS',
        headers: { Origin: origin },
      });
      const res = publicBookingOptionsResponse({
        request: req,
        allowedMethods: [...PUBLIC_BOOKING_ROUTE_CORS.create.methods],
        allowedHeaders: PUBLIC_BOOKING_ROUTE_CORS.create.headers,
        environment: env,
      });
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(origin);
      expect(res.headers.get('Access-Control-Allow-Headers')).toContain(
        'Idempotency-Key',
      );
      expect(res.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
      expect(res.headers.get('Access-Control-Max-Age')).toBe('600');
      expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
      expect(res.headers.get('Access-Control-Expose-Headers')).toBe(
        PUBLIC_BOOKING_CORS_EXPOSE_HEADERS_VALUE,
      );
    }
  });

  it('cancel and cancel-by-code OPTIONS allow Idempotency-Key', () => {
    for (const path of [
      '/api/public/booking/cancel',
      '/api/public/booking/BK-TEST/cancel',
    ]) {
      const req = new NextRequest(`http://localhost${path}`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://cutsaloon.com' },
      });
      const family = path.includes('BK-TEST')
        ? PUBLIC_BOOKING_ROUTE_CORS['cancel-by-code']
        : PUBLIC_BOOKING_ROUTE_CORS.cancel;
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
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
        'https://cutsaloon.com',
      );
    }
  });

  it('validation errors keep exact ACAO + Expose-Headers', () => {
    const req = new NextRequest('http://localhost/api/public/booking/plan', {
      method: 'POST',
      headers: { Origin: 'https://www.cutsaloon.com' },
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
      'https://www.cutsaloon.com',
    );
    expect(res.headers.get('Vary')).toContain('Origin');
    expect(res.headers.get('Access-Control-Expose-Headers')).toBe(
      PUBLIC_BOOKING_CORS_EXPOSE_HEADERS_VALUE,
    );
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });

  it('rejects suffix/subdomain/http/null origins without ACAO', () => {
    for (const origin of [
      'https://example.com',
      'https://evilcutsaloon.com',
      'https://cutsaloon.com.evil.com',
      'http://cutsaloon.com',
      'null',
    ]) {
      const req = new NextRequest('http://localhost/api/public/booking/create', {
        method: 'OPTIONS',
        headers: { Origin: origin },
      });
      const res = publicBookingOptionsResponse({
        request: req,
        allowedMethods: ['POST', 'OPTIONS'],
        allowedHeaders: PUBLIC_BOOKING_ROUTE_CORS.create.headers,
        environment: env,
      });
      expect(res.status).toBe(403);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    }
  });

  it('missing Origin continues without ACAO', () => {
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

  it('never sets wildcard or credentials', () => {
    const h = buildPublicBookingCorsHeaders({
      requestOrigin: 'https://cutsaloon.com',
      allowedMethods: ['POST', 'OPTIONS'],
      allowedHeaders: PUBLIC_BOOKING_ROUTE_CORS.create.headers,
      forPreflight: true,
      environment: env,
    });
    expect(Object.values(h).join(' ')).not.toContain('*');
    expect(h['Access-Control-Allow-Credentials']).toBeUndefined();
  });
});
