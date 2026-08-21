/**
 * Booking Phase 7C1 — centralized public booking CORS allowlist.
 * CORS is not authentication. No-Origin requests continue without ACAO.
 */
import { NextResponse } from 'next/server';

export type PublicBookingCorsMethod = 'GET' | 'POST' | 'OPTIONS';

export const PUBLIC_BOOKING_CORS_MAX_AGE_SECONDS = 600;
export const PUBLIC_BOOKING_CORS_CONTRACT_VERSION = 'booking-cors-v1';

const DEV_DEFAULT_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
] as const;

const DEFAULT_ALLOWED_HEADERS = [
  'Content-Type',
  'X-Booking-Canary-Key',
  'X-Client-Id',
] as const;
const IDEMPOTENCY_HEADERS = ['Content-Type', 'Idempotency-Key'] as const;
const LOOKUP_HEADERS = ['Content-Type', 'Authorization'] as const;

/**
 * Headers browsers may read from public booking responses.
 * Configured once here — do not duplicate per route.
 * Do not expose tokens or internal-only headers.
 */
export const PUBLIC_BOOKING_EXPOSED_HEADERS = [
  'X-Booking-Contract-Version',
  'X-Request-Id',
  'Retry-After',
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
  'Deprecation',
  'Warning',
  'ETag',
  'X-Bootstrap-Revision',
  'X-Bootstrap-Cache',
] as const;

/** @deprecated Use PUBLIC_BOOKING_EXPOSED_HEADERS — alias retained for Phase 8A1 tests. */
export const PUBLIC_BOOKING_CORS_EXPOSE_HEADERS = PUBLIC_BOOKING_EXPOSED_HEADERS;

export const PUBLIC_BOOKING_EXPOSED_HEADERS_VALUE =
  PUBLIC_BOOKING_EXPOSED_HEADERS.join(', ');

/** @deprecated Use PUBLIC_BOOKING_EXPOSED_HEADERS_VALUE */
export const PUBLIC_BOOKING_CORS_EXPOSE_HEADERS_VALUE =
  PUBLIC_BOOKING_EXPOSED_HEADERS_VALUE;

export const PUBLIC_BOOKING_CORS_HEADER_PRESETS = {
  read: [...DEFAULT_ALLOWED_HEADERS],
  mutate: [...IDEMPOTENCY_HEADERS],
  lookup: [...LOOKUP_HEADERS],
  upcoming: [...DEFAULT_ALLOWED_HEADERS],
} as const;

type EnvLike = {
  NODE_ENV?: string;
  PUBLIC_BOOKING_ALLOWED_ORIGINS?: string;
  VERCEL_ENV?: string;
};

type OriginCache = {
  key: string;
  origins: string[];
  source: 'env' | 'dev_default' | 'empty';
  warnedEmptyProd: boolean;
};

let originCache: OriginCache | null = null;
let lastRejectLogAt = 0;
const REJECT_LOG_MIN_MS = 5_000;

export type ResolvedPublicBookingCorsPolicy =
  | { kind: 'no_origin' }
  | { kind: 'allowed'; origin: string }
  | { kind: 'disallowed'; origin: string; reason: string };

function isProductionEnv(env: EnvLike): boolean {
  return env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production';
}

/**
 * Normalize a configured or request Origin to a comparable absolute origin.
 * Rejects paths, queries, hashes, wildcards, and malformed values.
 */
export function normalizePublicBookingOrigin(raw: unknown): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  if (trimmed === '*' || trimmed.includes('*')) return null;
  if (/\s/.test(trimmed)) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  // Configured values must be origin-only (no path/query/hash beyond "/").
  if (url.search || url.hash) return null;
  if (url.pathname && url.pathname !== '/') return null;

  const host = url.hostname.toLowerCase();
  if (!host) return null;

  const port =
    url.port &&
    !(
      (url.protocol === 'https:' && url.port === '443') ||
      (url.protocol === 'http:' && url.port === '80')
    )
      ? `:${url.port}`
      : '';

  return `${url.protocol}//${host}${port}`;
}

export function parsePublicBookingAllowedOrigins(raw: string | undefined | null): string[] {
  if (raw == null || !String(raw).trim()) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of String(raw).split(',')) {
    const n = normalizePublicBookingOrigin(part);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

export function getPublicBookingAllowedOrigins(env: EnvLike = process.env): {
  origins: string[];
  source: 'env' | 'dev_default' | 'empty';
} {
  const key = `${env.NODE_ENV ?? ''}|${env.VERCEL_ENV ?? ''}|${env.PUBLIC_BOOKING_ALLOWED_ORIGINS ?? ''}`;
  if (originCache?.key === key) {
    return { origins: originCache.origins, source: originCache.source };
  }

  const fromEnv = parsePublicBookingAllowedOrigins(env.PUBLIC_BOOKING_ALLOWED_ORIGINS);
  let origins: string[];
  let source: 'env' | 'dev_default' | 'empty';

  if (fromEnv.length > 0) {
    origins = fromEnv;
    source = 'env';
  } else if (!isProductionEnv(env)) {
    origins = [...DEV_DEFAULT_ORIGINS];
    source = 'dev_default';
  } else {
    origins = [];
    source = 'empty';
    if (!originCache?.warnedEmptyProd) {
      console.warn(
        JSON.stringify({
          event: 'public_booking.cors_allowlist_empty',
          message:
            'PUBLIC_BOOKING_ALLOWED_ORIGINS is empty in production — cross-origin browser calls will not receive ACAO',
          timestamp: new Date().toISOString(),
        }),
      );
    }
  }

  originCache = {
    key,
    origins,
    source,
    warnedEmptyProd: source === 'empty' || Boolean(originCache?.warnedEmptyProd),
  };
  return { origins, source };
}

/** Test helper — clear cached allowlist. */
export function resetPublicBookingCorsCacheForTests(): void {
  originCache = null;
  lastRejectLogAt = 0;
}

export function resolvePublicBookingCorsPolicy(args: {
  requestOrigin: string | null | undefined;
  environment?: EnvLike;
}): ResolvedPublicBookingCorsPolicy {
  const env = args.environment ?? process.env;
  const raw = args.requestOrigin;

  // Missing Origin → not a browser CORS request.
  if (raw == null || String(raw).trim() === '') {
    return { kind: 'no_origin' };
  }

  // Explicit "null" Origin is not equivalent to missing Origin.
  if (String(raw).trim().toLowerCase() === 'null') {
    return { kind: 'disallowed', origin: 'null', reason: 'null_origin' };
  }

  const normalized = normalizePublicBookingOrigin(raw);
  if (!normalized) {
    return {
      kind: 'disallowed',
      origin: String(raw).trim().slice(0, 120),
      reason: 'malformed_origin',
    };
  }

  const { origins } = getPublicBookingAllowedOrigins(env);
  if (origins.includes(normalized)) {
    return { kind: 'allowed', origin: normalized };
  }

  return { kind: 'disallowed', origin: normalized, reason: 'not_allowlisted' };
}

export function logPublicBookingCorsRejected(args: {
  origin: string;
  pathname?: string;
  method?: string;
  environment?: string;
}): void {
  const now = Date.now();
  if (now - lastRejectLogAt < REJECT_LOG_MIN_MS) return;
  lastRejectLogAt = now;
  console.warn(
    JSON.stringify({
      event: 'public_booking.cors_origin_rejected',
      origin: args.origin.slice(0, 120),
      pathname: args.pathname ?? null,
      method: args.method ?? null,
      environment: args.environment ?? process.env.NODE_ENV ?? null,
      timestamp: new Date().toISOString(),
    }),
  );
}

export type BuildCorsHeadersArgs = {
  requestOrigin: string | null | undefined;
  allowedMethods: PublicBookingCorsMethod[];
  allowedHeaders?: readonly string[];
  forPreflight?: boolean;
  environment?: EnvLike;
  pathname?: string;
  method?: string;
};

/**
 * Build CORS response headers for an approved Origin.
 * Disallowed / no-origin → no ACAO (and Vary: Origin when Origin was present).
 */
export function buildPublicBookingCorsHeaders(
  args: BuildCorsHeadersArgs,
): Record<string, string> {
  const policy = resolvePublicBookingCorsPolicy({
    requestOrigin: args.requestOrigin,
    environment: args.environment,
  });

  const methods = [...new Set([...args.allowedMethods, 'OPTIONS' as const])]
    .filter((m) => m === 'GET' || m === 'POST' || m === 'OPTIONS')
    .join(', ');
  const headersList = (args.allowedHeaders ?? DEFAULT_ALLOWED_HEADERS).join(', ');

  if (policy.kind === 'no_origin') {
    const h: Record<string, string> = {};
    if (args.forPreflight) {
      // Preflight without Origin is unusual; still advertise methods for tooling.
      h['Access-Control-Allow-Methods'] = methods;
      h['Access-Control-Allow-Headers'] = headersList;
      h['Access-Control-Max-Age'] = String(PUBLIC_BOOKING_CORS_MAX_AGE_SECONDS);
    }
    return h;
  }

  if (policy.kind === 'disallowed') {
    logPublicBookingCorsRejected({
      origin: policy.origin,
      pathname: args.pathname,
      method: args.method,
      environment: args.environment?.NODE_ENV ?? process.env.NODE_ENV,
    });
    return { Vary: 'Origin' };
  }

  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': policy.origin,
    Vary: 'Origin',
    // Required so browser JS on cutsaloon.com can read booking metadata headers.
    'Access-Control-Expose-Headers': PUBLIC_BOOKING_EXPOSED_HEADERS_VALUE,
  };

  if (args.forPreflight) {
    headers['Access-Control-Allow-Methods'] = methods;
    headers['Access-Control-Allow-Headers'] = headersList;
    headers['Access-Control-Max-Age'] = String(PUBLIC_BOOKING_CORS_MAX_AGE_SECONDS);
  }

  // Never set Access-Control-Allow-Credentials for public booking.
  return headers;
}

function mergeHeaders(
  base: HeadersInit | undefined,
  extra: Record<string, string>,
): Headers {
  const h = new Headers(base);
  for (const [k, v] of Object.entries(extra)) {
    if (k.toLowerCase() === 'vary') {
      const existing = h.get('Vary');
      if (existing) {
        const parts = new Set(
          existing
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        );
        for (const p of v.split(',').map((s) => s.trim()).filter(Boolean)) {
          parts.add(p);
        }
        h.set('Vary', [...parts].join(', '));
      } else {
        h.set('Vary', v);
      }
    } else {
      h.set(k, v);
    }
  }
  return h;
}

export function withPublicBookingCors(
  response: NextResponse,
  request: Request,
  options: {
    allowedMethods: PublicBookingCorsMethod[];
    allowedHeaders?: readonly string[];
    cacheControl?: string | null;
    environment?: EnvLike;
  },
): NextResponse {
  const cors = buildPublicBookingCorsHeaders({
    requestOrigin: request.headers.get('origin'),
    allowedMethods: options.allowedMethods,
    allowedHeaders: options.allowedHeaders,
    forPreflight: false,
    environment: options.environment,
    pathname: (() => {
      try {
        return new URL(request.url).pathname;
      } catch {
        return undefined;
      }
    })(),
    method: request.method,
  });

  if (options.cacheControl) {
    cors['Cache-Control'] = options.cacheControl;
  }

  const merged = mergeHeaders(response.headers, cors);
  return new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  });
}

export function publicBookingOptionsResponse(args: {
  request: Request;
  allowedMethods: PublicBookingCorsMethod[];
  allowedHeaders?: readonly string[];
  environment?: EnvLike;
}): NextResponse {
  const origin = args.request.headers.get('origin');
  const policy = resolvePublicBookingCorsPolicy({
    requestOrigin: origin,
    environment: args.environment,
  });

  let pathname: string | undefined;
  try {
    pathname = new URL(args.request.url).pathname;
  } catch {
    pathname = undefined;
  }

  if (policy.kind === 'disallowed') {
    logPublicBookingCorsRejected({
      origin: policy.origin,
      pathname,
      method: 'OPTIONS',
      environment: args.environment?.NODE_ENV ?? process.env.NODE_ENV,
    });
    // Prefer nested error via catalog when available — inline safe body to avoid cycle.
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'CORS_ORIGIN_NOT_ALLOWED',
          message: 'هذا المصدر غير مسموح له بالوصول إلى خدمة الحجز',
          technicalMessage: 'Request origin is not in the public booking allowlist',
          metadata: {},
        },
      },
      {
        status: 403,
        headers: { Vary: 'Origin', 'Cache-Control': 'no-store' },
      },
    );
  }

  const cors = buildPublicBookingCorsHeaders({
    requestOrigin: origin,
    allowedMethods: args.allowedMethods,
    allowedHeaders: args.allowedHeaders,
    forPreflight: true,
    environment: args.environment,
    pathname,
    method: 'OPTIONS',
  });

  return new NextResponse(null, {
    status: 204,
    headers: {
      ...cors,
      'Cache-Control': 'no-store',
    },
  });
}

export function publicBookingJson(
  request: Request,
  body: unknown,
  options: {
    status?: number;
    allowedMethods: PublicBookingCorsMethod[];
    allowedHeaders?: readonly string[];
    cacheControl?: string | null;
    environment?: EnvLike;
    headers?: HeadersInit;
  },
): NextResponse {
  const res = NextResponse.json(body, {
    status: options.status ?? 200,
    headers: options.headers,
  });
  return withPublicBookingCors(res, request, {
    allowedMethods: options.allowedMethods,
    allowedHeaders: options.allowedHeaders,
    cacheControl: options.cacheControl === undefined ? 'no-store' : options.cacheControl,
    environment: options.environment,
  });
}

export function publicBookingRateLimitedResponse(
  request: Request,
  options: {
    allowedMethods: PublicBookingCorsMethod[];
    allowedHeaders?: readonly string[];
    environment?: EnvLike;
  },
): NextResponse {
  return publicBookingJson(
    request,
    {
      ok: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'طلبات كثيرة — حاول لاحقاً',
        technicalMessage: 'Too many requests',
        metadata: {},
      },
    },
    {
      status: 429,
      allowedMethods: options.allowedMethods,
      allowedHeaders: options.allowedHeaders,
      cacheControl: 'no-store',
      environment: options.environment,
    },
  );
}

/** Route family method matrix (Phase 7C1). */
export const PUBLIC_BOOKING_ROUTE_CORS: Record<
  string,
  { methods: PublicBookingCorsMethod[]; headers: readonly string[] }
> = {
  branches: { methods: ['GET', 'OPTIONS'], headers: PUBLIC_BOOKING_CORS_HEADER_PRESETS.read },
  config: { methods: ['GET', 'OPTIONS'], headers: PUBLIC_BOOKING_CORS_HEADER_PRESETS.read },
  status: { methods: ['GET', 'OPTIONS'], headers: PUBLIC_BOOKING_CORS_HEADER_PRESETS.read },
  services: { methods: ['GET', 'OPTIONS'], headers: PUBLIC_BOOKING_CORS_HEADER_PRESETS.read },
  barbers: { methods: ['GET', 'OPTIONS'], headers: PUBLIC_BOOKING_CORS_HEADER_PRESETS.read },
  calendar: { methods: ['GET', 'OPTIONS'], headers: PUBLIC_BOOKING_CORS_HEADER_PRESETS.read },
  location: { methods: ['GET', 'OPTIONS'], headers: PUBLIC_BOOKING_CORS_HEADER_PRESETS.read },
  'barber-available-slots': {
    methods: ['GET', 'OPTIONS'],
    headers: PUBLIC_BOOKING_CORS_HEADER_PRESETS.read,
  },
  'cross-branch-availability': {
    methods: ['POST', 'OPTIONS'],
    headers: PUBLIC_BOOKING_CORS_HEADER_PRESETS.read,
  },
  'barber-availability-days': {
    methods: ['POST', 'OPTIONS'],
    headers: PUBLIC_BOOKING_CORS_HEADER_PRESETS.read,
  },
  'barber-availability-slots': {
    methods: ['POST', 'OPTIONS'],
    headers: PUBLIC_BOOKING_CORS_HEADER_PRESETS.read,
  },
  'available-days': { methods: ['GET', 'OPTIONS'], headers: PUBLIC_BOOKING_CORS_HEADER_PRESETS.read },
  'available-slots': {
    methods: ['GET', 'OPTIONS'],
    headers: PUBLIC_BOOKING_CORS_HEADER_PRESETS.read,
  },
  'v2-bootstrap': { methods: ['GET', 'OPTIONS'], headers: PUBLIC_BOOKING_CORS_HEADER_PRESETS.read },
  'v2-availability': {
    methods: ['POST', 'OPTIONS'],
    headers: PUBLIC_BOOKING_CORS_HEADER_PRESETS.read,
  },
  'check-slot': { methods: ['POST', 'OPTIONS'], headers: PUBLIC_BOOKING_CORS_HEADER_PRESETS.read },
  plan: { methods: ['POST', 'OPTIONS'], headers: PUBLIC_BOOKING_CORS_HEADER_PRESETS.read },
  create: { methods: ['POST', 'OPTIONS'], headers: PUBLIC_BOOKING_CORS_HEADER_PRESETS.mutate },
  lookup: { methods: ['GET', 'OPTIONS'], headers: PUBLIC_BOOKING_CORS_HEADER_PRESETS.lookup },
  upcoming: { methods: ['POST', 'OPTIONS'], headers: PUBLIC_BOOKING_CORS_HEADER_PRESETS.upcoming },
  cancel: { methods: ['POST', 'OPTIONS'], headers: PUBLIC_BOOKING_CORS_HEADER_PRESETS.mutate },
  'cancel-by-code': {
    methods: ['POST', 'OPTIONS'],
    headers: PUBLIC_BOOKING_CORS_HEADER_PRESETS.mutate,
  },
};
