# Booking Phase 3 — Branch-first barbers

`GET /api/public/booking/barbers?mode=branch&branchCode=GLEEM`

- `branchCode` **required** → else `BRANCH_REQUIRED`
- Resolves via `resolvePublicBookingBranchContext({ purpose: 'public_booking' })`
- CAMP_CAESAR → `BRANCH_NOT_PUBLIC`
- Without `date`: roster of assigned + `CanReceiveBookings` + public services
- With `date`: only barbers whose public resolved location equals that branch on the WorkDate
- Optional `serviceIds`: all must be Phase-2 public services (else `SERVICE_NOT_AVAILABLE_AT_BRANCH`)
- Response includes `branch: { branchCode, branchName }`
- No GLEEM inference from missing code
