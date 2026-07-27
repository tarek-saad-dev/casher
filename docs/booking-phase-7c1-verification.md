# Booking Phase 7C1 — Verification (updated Phase 8A1)

## Live probe — historical 7C1

| Field | Value |
|---|---|
| Phase | booking-phase-7c1-cors-proof |
| Result | **PASSED** (earlier artifact) |
| Artifact | `_booking-phase7c1-cors-proof.json` |

## Live probe — Phase 8A1 production alias (2026-07-27)

| Field | Value |
|---|---|
| Alias | `https://casher-five.vercel.app` |
| Origins | `https://cutsaloon.com`, `https://www.cutsaloon.com` |
| Root/www GET ACAO | **PASS** |
| Create/cancel OPTIONS + Idempotency-Key | **PASS** |
| Disallowed / null Origin | **PASS** (403, no ACAO) |
| No-Origin GET | **PASS** |
| Camp Caesar | **PASS** (`BRANCH_NOT_PUBLIC`) |
| Admin isolation | **PASS** (401) |
| Access-Control-Expose-Headers on production | **PASS** (Phase 8A2 commit `39e1e9e`) |
| Browser-readable metadata from cutsaloon.com | **PASS** (Phase 8A2) |

Full detail: `docs/booking-phase-8a2-expose-headers-proof.md` (supersedes 8A1 NO-GO for Expose-Headers)

## Tests / build (8A1 session)

- Phase 7C1 + 8A1 CORS suites PASS
- Contract/security sample PASS
- ESLint clean on touched CORS files
- `npm run build` PASS
