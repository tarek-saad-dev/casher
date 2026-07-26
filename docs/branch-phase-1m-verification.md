# Phase 1M — Verification

## Preflight (Phase 1M-S)

| Check | Result |
|---|---|
| Vitest 1M+1L…1G (10 files) | **99 passed** |
| `verify-branch-provisioning-readiness-smoke.ts` cloud/last132 | **PASS** |
| `verify-employee-financial-branch-ownership.ts` + nested 1K | **PASS** |
| `npm run build` | **PASS** |
| ESLint touched 1M-S files | **0 errors / 0 warnings** |

## Live controlled smoke

| Check | Result |
|---|---|
| SmokeRunID 3 | **PASSED** → **CLEANED** |
| GLEEM isolation | **PASS** |
| Cleanup / SETUP restore | **PASS** |
| Details | `docs/branch-phase-1m-smoke-results.md` |

## Post-smoke regression

| Check | Result |
|---|---|
| Same 10 vitest files | **99 passed** |
| 1M live verifier | **PASS** (PH1GTEST SETUP, inactive, non-public) |

## Commands

```bash
npx tsx scripts/branch-smoke/run-phase1m-controlled-smoke.ts --confirm --expected-database=last132 --mode=cloud --actor-user-id=10

npx tsx scripts/branch-smoke/cleanup-branch-smoke-run.ts --smoke-run-id=3
npx tsx scripts/branch-smoke/cleanup-branch-smoke-run.ts --smoke-run-id=3 --confirm
```
