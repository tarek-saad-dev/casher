# Booking Phase 1 — Public error contract

Preferred JSON shape for new public booking errors:

```json
{
  "ok": false,
  "error": {
    "code": "BRANCH_REQUIRED",
    "message": "اختر الفرع أولًا",
    "technicalMessage": "branchCode is required"
  }
}
```

## Codes (branch context)

| Code | HTTP | When |
|------|------|------|
| `BRANCH_REQUIRED` | 400 | Missing/empty branchCode on branch-scoped route |
| `INVALID_BRANCH_CODE` | 400 | Malformed or numeric BranchID spoof |
| `BRANCH_NOT_FOUND` | 404 | Unknown branchCode |
| `BRANCH_NOT_PUBLIC` | 404 | Exists but not publicly bookable (no lifecycle leak) |
| `BRANCH_BOOKING_DISABLED` | 409 | Reserved for temporarily disabled public booking |

Helpers: `src/lib/booking/publicBookingErrorCatalog.ts`  
`publicBookingErrorResponse(code)` attaches CORS headers.

Public errors must **not** expose BranchID, LifecycleStatus, readiness blockers, or DB messages.

Legacy unmigrated routes may still return flat `{ error, message }` until Phase 2+.
