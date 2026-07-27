# Booking Phase 3 — Security & privacy

- No `internal_preview` via query; `preview` / `includeTest` / `BranchID` ignored
- Test/smoke EmpIDs → `BARBER_NOT_FOUND`
- Nested errors + CORS on all statuses
- No salary/payroll/phone/private notes
- Wildcard CORS (`*`) remains a later booking task
- Cache TTL 20s, max 32 entries; invalidate via `invalidatePublicBookingBarbersCache`
