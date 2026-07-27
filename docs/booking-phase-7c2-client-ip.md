# Booking Phase 7C2 — Client IP Resolution

**Source:** `src/lib/booking/publicBookingClientIp.ts`

Used exclusively for public booking **rate-limit keys** (not authentication / ownership).

## Trust model

`isTrustedProxyContext` is true when any of:

- `VERCEL === '1'`
- `VERCEL_ENV` is set
- `NODE_ENV === 'production'`

## Resolution order

1. **`x-real-ip`** — if present and validates as IPv4/IPv6 → use it  
2. **`x-forwarded-for`**
   - Trusted proxy: first hop only  
   - Dev/local (untrusted): only if **single** hop and valid  
3. Else → **`anonymous`**

## Validation

| Rule | Value |
|---|---|
| Max length | 64 |
| IPv4 | dotted decimal 0–255 octets |
| IPv6 | hex + `:` only (simple pattern) |
| Invalid | skip to next source / `anonymous` |

## Security notes

- Long XFF chains are **not** trusted outside Vercel/production.
- Clients cannot force a preferred IP via body/query.
- Rate-limit subject digests are separate; IP alone is used for non–subject-aware families.
- IP is also passed into cancel `requestContext` for audit (not as ownership proof).
