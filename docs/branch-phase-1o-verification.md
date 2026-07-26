# Phase 1O — Verification

## Live config apply (`last132`)

| Check | Result |
|---|---|
| `apply-phase1o-camp-caesar-config.ts` | Applied · `_phase1o-apply-result.json` |
| CC lifecycle | SETUP · IsActive=0 · PublicBooking=0 · ExternalNotifications=0 · BookingEnabled=0 |
| Hours / contact / EN display | 11:00–01:30 · كامب شيزار · 01012126899 · SalonName=Camp Caesar |
| Service parity mismatches | **0** (global `TblPro`; active serv snapshot Dry-Hair) |
| User access | 9 (created 8, updated 1) |
| Partner draft | 100% · IsActive=0 · EffectiveFrom PENDING |
| Shared printer / WhatsApp | Approved · prints=0 · sends=0 |
| GLEEM partners / isolation | Unchanged |
| INTERNAL_LIVE / PUBLIC_LIVE | **NO-GO** |

## Focused 1O smoke

| Item | Value |
|---|---|
| SmokeRunID | **13** |
| Status | PASSED → CLEANED |
| Retained proofs | SmokeRunID **11** technical keys merged into ResultJson |
| Runner | `scripts/branch-smoke/run-phase1o-focused-smoke.ts` |

## Tests / verifiers

```bash
npx vitest run src/lib/__tests__/phase1o src/lib/__tests__/phase1n … phase1g
# → 135 passed

npx tsx scripts/verify-camp-caesar-real-configuration.ts
# → VERIFY_CAMP_CAESAR_REAL_CONFIGURATION: PASS

npx tsx scripts/verify-camp-caesar-operational-readiness.ts --mode=cloud --expected-database=last132
```
