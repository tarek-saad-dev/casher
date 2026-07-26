# Phase 1Q — Verification

| Check | Result |
|---|---|
| Migration / GLEEM backfill | 98 rows · legacy fingerprint unchanged · CC/PH1GTEST = 0 |
| SmokeRunID 14 | PASSED → CLEANED |
| Vitest 1Q→1G | **147 passed** |
| `verify-cross-branch-employee-scheduling-booking.ts` | **PASS** |
| ESLint (new 1Q modules) | clean |
| Camp Caesar | SETUP · IsActive=0 · PublicBooking=0 |

```bash
npx tsx scripts/migrate-phase1q-branch-schedules.ts
npx tsx scripts/branch-smoke/run-phase1q-cross-branch-smoke.ts
npx tsx scripts/verify-cross-branch-employee-scheduling-booking.ts
npx vitest run src/lib/__tests__/phase1q … phase1g
```
