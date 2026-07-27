# Booking Phase 7C2 — Rate Limit Policy

**Source:** `src/lib/booking/publicBookingRateLimitPolicy.ts`  
**Gate:** `src/lib/booking/publicBookingRouteGate.ts`

## Storage

| Property | Value |
|---|---|
| Kind | `in-memory` (`getRateLimitStorageKind()`) |
| Structure | `Map` of buckets `{ count, resetAt }` |
| Scope | Best-effort **per process instance** — not distributed |
| Window | `60_000` ms for all families |

Not suitable as a hard global quota across Vercel/serverless replicas. Protects against casual abuse and accidental loops on a single instance.

## Baseline matrix (audited)

| Family | Limit / 60s | Subject-aware |
|---|---|---|
| discovery | 60 | no |
| catalog | 45 | no |
| barbers | 45 | no |
| availability | 30 | no |
| available-days | 20 | no |
| validation | 20 | no |
| plan | 15 | no |
| create | 8 | no |
| lookup | 30 | yes |
| upcoming | 15 | yes |
| cancel | 10 | yes |

## Route key → family

| Route key | Family |
|---|---|
| `branches`, `config`, `status` | discovery |
| `services` | catalog |
| `barbers`, `location` | barbers |
| `calendar`, `barber-available-slots`, `available-slots` | availability |
| `available-days` | available-days |
| `check-slot` | validation |
| `plan` | plan |
| `create` | create |
| `lookup` | lookup |
| `upcoming` | upcoming |
| `cancel`, `cancel-by-code` | cancel |

Unknown route key falls back to **discovery** in the gate.

## Subject digests

One-way SHA-256 prefix (16 hex chars); never store raw phone/code:

```
sha256(`p7c2-rl:${kind}:${normalized.toLowerCase()}`).slice(0, 16)
```

| Route | Subject kind | Input |
|---|---|---|
| lookup | `code` | path booking code |
| upcoming | `phone` | normalized phone |
| cancel / cancel-by-code | `code` | body or path code |

Key shapes:

- IP-only: `pb:{family}:{ip}`
- Subject-aware: `pb:{family}:{ip}:{subjectDigest}`

## Env overrides

`PUBLIC_BOOKING_RL_{FAMILY}` where family uses underscores (`AVAILABLE_DAYS`, `CHECK` not used — family names as in matrix).

- Parsed as integer; accepted range **1–500**
- Invalid / empty → baseline

## 429 response

- Error code: `RATE_LIMIT_EXCEEDED`
- Body metadata: `{ retryAfterSeconds }`
- Headers: `X-RateLimit-*`, `Retry-After`, CORS allowlist, `Cache-Control: no-store`, contract version + request id
