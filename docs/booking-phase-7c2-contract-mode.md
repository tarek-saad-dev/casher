# Booking Phase 7C2 — Contract Mode

**Source:** `src/lib/booking/publicBookingContractMode.ts`

## Constants

| Constant | Value |
|---|---|
| `PUBLIC_BOOKING_API_CONTRACT_VERSION` | `booking-public-v1` |
| `PUBLIC_BOOKING_CONTRACT_VERSION_HEADER` | `X-Booking-Contract-Version` |
| Env var | `PUBLIC_BOOKING_CONTRACT_MODE` |
| Default | `compat` |
| Modes | `compat` \| `enforce` |

Mode is **env-only**. Clients cannot override via query, body, or header.

## Behavior

### `compat` (default — production must stay here until frontend cutover)

| Surface | Missing `planToken` | Missing idempotency / `clientRequestId` |
|---|---|---|
| **create** | Allowed; logs `public_booking.legacy_contract_used`; response may include `compatibility` + `Deprecation` / `Warning` headers | Same |
| **cancel** | N/A | Routes do **not** pass `allowMissingIdempotencyKey` → still `IDEMPOTENCY_KEY_REQUIRED` |

Create compatibility metadata:

```ts
{ legacyRequestAccepted: true, missingPlanToken?: true, missingIdempotencyKey?: true }
```

Deprecation headers when legacy accepted:

| Header | Value |
|---|---|
| `Deprecation` | `true` |
| `Warning` | `299 - "Legacy public booking request contract"` |

### `enforce`

| Surface | Missing requirement | Error |
|---|---|---|
| **create** | no `planToken` | `PLAN_TOKEN_REQUIRED` (400) |
| **create** | no idempotency key | `IDEMPOTENCY_KEY_REQUIRED` (400) |
| **cancel** | no idempotency key | `IDEMPOTENCY_KEY_REQUIRED` (400) |

Production warn (once per process) when enforce is active:

```json
{ "event": "public_booking.contract_mode_enforce", "message": "PUBLIC_BOOKING_CONTRACT_MODE=enforce is active" }
```

Catalog also defines `LEGACY_BOOKING_CONTRACT_DISABLED` (400) for future hard cutover messaging.

## `.env.example`

```
PUBLIC_BOOKING_CONTRACT_MODE=compat
```

## Production activation

**NO-GO** for `enforce` in production until cutsaloon.com (and other public clients) send `planToken` + Idempotency-Key / `clientRequestId` on create, and continue sending idempotency on cancel.
