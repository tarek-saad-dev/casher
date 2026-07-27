# Booking Phase 1 — Verification

## Commands

```bash
npx vitest run src/lib/__tests__/bookingPublicBranchContext.test.ts
npx vitest run src/lib/__tests__/phase1mPublicBookingBranchSelection.test.ts
npx vitest run src/lib/__tests__/phase1fBookingQueueOwnership.test.ts
npx vitest run src/lib/__tests__/phase1q*.test.ts
npm run build
npx eslint --max-warnings 0 <touched files>
```

## Expected public samples (contract)

**GET /api/public/branches** → `{ ok: true, branches: [ { branchCode: "GLEEM", ... } ] }` — no CAMP_CAESAR

**GET /api/public/booking/config?branchCode=GLEEM** → 200 + GLEEM identity/hours/timezone

**GET /api/public/booking/config** (no code) → 400 `BRANCH_REQUIRED`

**GET /api/public/booking/config?branchCode=CAMP_CAESAR** → 404 `BRANCH_NOT_PUBLIC` (no CC config fields)

**GET /api/public/booking/status?branchCode=CAMP_CAESAR** → 404 `BRANCH_NOT_PUBLIC`

## Remaining for Booking Phase 2

Migrate: services, barbers (branch mode), available-days, available-slots onto the same resolver (still no create/plan).
