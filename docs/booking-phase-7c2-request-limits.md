# Booking Phase 7C2 — Request Limits

**Source:** `src/lib/booking/publicBookingRequestLimits.ts`

Bounded complexity constants for public booking requests. Helpers: `validatePublicServiceIdsCount`, `validateBoundedString`.

## Constants (audited)

| Limit | Value | Typical field |
|---|---|---|
| `maxServiceIds` | 12 | `serviceIds` array length |
| `maxNotesLength` | 500 | create `notes` |
| `maxCustomerNameLength` | 120 | customer name |
| `maxReasonTextLength` | 250 | cancel `reasonText` |
| `maxUpcomingLimit` | 25 | upcoming `limit` (reader also caps at 25; default 10) |
| `maxCalendarRangeDays` | 31 | calendar / available-days span (`MAX_PUBLIC_BARBER_CALENDAR_DAYS` = 31) |
| `maxIdempotencyKeyLength` | 128 | `Idempotency-Key` / `clientRequestId` (create slices to 128) |
| `maxClientRequestIdLength` | 128 | alias of idempotency length |
| `maxBookingCodeLength` | 32 | booking code |
| `maxPlanTokenLength` | 4096 | `planToken` |
| `maxAccessTokenLength` | 4096 | booking access token |

## Violation shape

```ts
{
  field: string;
  code: 'INVALID_REQUEST' | 'INVALID_LIMIT' | 'INVALID_NOTES' | 'INVALID_BOOKING_CODE';
  message: string;
}
```

`validatePublicServiceIdsCount`: over max → `INVALID_REQUEST` with message `Too many services (max 12)`.

`validateBoundedString`: over length → `INVALID_REQUEST` with `{field} exceeds maximum length`.

## Alignment notes

- Upcoming reader: `DEFAULT_UPCOMING_LIMIT = 10`, `MAX_UPCOMING_LIMIT = 25` (matches `maxUpcomingLimit`).
- Calendar span policy already rejects ranges > 31 via `DATE_RANGE_TOO_LARGE`.
- Module is the Phase 7C2 single source for documented caps; wire all new public validators through these constants.
