# Booking Phase 7B — Security

- Numeric BookingID rejected
- Code-only cancel rejected
- Wrong phone / token → generic unauthorized
- Internal / smoke_seed / `[SMOKE` notes / P6C-* hidden
- Client cannot force Status / CancelledAt / BranchID / CustomerID
- reasonText ≤ 250 chars; approved reasonCode set
- Response omits BookingID, CustomerID, phone, lock keys, Notes metadata
- Rate limit: 10/min/IP (`cancel:{ip}`)
- CORS via `PUBLIC_CORS_HEADERS` on all outcomes; final allowlist = Phase 7C
