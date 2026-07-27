# Booking Phase 8D — Post-Cutover Monitoring

**Date:** 2026-07-28  
**Alias:** `https://casher-five.vercel.app`  
**Scope:** public booking health after `PUBLIC_BOOKING_CONTRACT_MODE=enforce`

## Deliverables

| Surface | Path |
|---|---|
| Health metrics + 24h summary | `src/lib/booking/publicBookingHealthMetrics.ts` |
| Request log + sample wiring | `src/lib/booking/publicBookingRouteGate.ts` |
| Admin read-only API | `GET /api/admin/public-booking/health` (`requireAdmin`) |
| CLI report | `scripts/report-booking-phase8d-health.ts` → `_booking-phase8d-health.json` |
| Sample table | `dbo.TblPublicBookingHealthSample` (auto-ensure, 36h retention prune) |

## What is tracked

| Signal | Source |
|---|---|
| Create success / failure by error code | `TblPublicBookingCreateRequest` + pre-claim samples |
| Cancel success / failure | `TblPublicBookingCancelRequest` + pre-claim samples |
| Idempotent replays | health samples (`outcome=idempotent_replay`) |
| PLAN_TOKEN_* errors | durable FAILED + pre-claim samples |
| `mutation_outcome_unknown` | stuck PENDING (>5m) + uncaught create/cancel |
| Rate-limit events | samples (`outcome=rate_limited`) |
| p50 / p95 timings | samples for availability / plan / create / cancel |

## Privacy rules

- No phones, names, tokens, fingerprints, or booking codes in health samples or summary JSON.
- Console `public_booking.request` logs only: requestId, routeFamily, method, status, errorCode, durationMs.

## Usage

```bash
# Admin session cookie required for HTTP:
# GET /api/admin/public-booking/health

# CLI (uses DATABASE_URL / app DB config):
npx tsx scripts/report-booking-phase8d-health.ts
```

## Notes

- Timings / rate-limit / replay counts populate only **after** 8D wiring is deployed.
- Historical create/cancel success|failure still available from idempotency tables for the last 24h.
- No public contract changes. No Camp Caesar changes.

## Verification

| Check | Result |
|---|---|
| Focused Phase 8D tests | **PASS** (6) |
| Related CORS/enforce tests | **PASS** |
| ESLint (touched files) | **PASS** |
| `npm run build` | **PASS** |
| CLI `report-booking-phase8d-health.ts` | **PASS** — wrote `_booking-phase8d-health.json` |

### Sample last-24h snapshot (CLI against cloud DB, 2026-07-28)

| Metric | Value |
|---|---|
| Create success / failure | **28** / **12** (`SLOT_UNAVAILABLE`) |
| Cancel success / failure | **37** / **7** |
| PLAN_TOKEN errors | **0** (pre-deploy samples empty; enforce rejections are pre-claim) |
| mutation_outcome_unknown | **0** |
| Rate-limit / replay / timings | **0** until 8D wiring is deployed to production |

CLI `contractMode` reflects the **local** `PUBLIC_BOOKING_CONTRACT_MODE` env of the runner; production admin endpoint reports the live Vercel env.

## Verdict

**GO** — lightweight post-cutover health surface shipped (admin API + CLI + anonymized samples). Deploy required before sample-backed timings / rate-limit / replay counters populate in production.
