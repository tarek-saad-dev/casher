# Booking Phase 5 — Any-barber plan

- Mode `any_barber` when `empId` omitted.
- `assignmentStrategy = server_select_on_create`.
- `barber = null`; `candidateBarbers` = EmpID-deduped public-safe list (display order → Arabic name → EmpID).
- No guaranteed assignment; first candidate is presentation-only.
- Create (Phase 6) selects under transaction + lock.
