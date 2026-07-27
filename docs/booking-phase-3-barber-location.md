# Booking Phase 3 — Barber location

`GET /api/public/booking/barbers/{empId}/location?date=YYYY-MM-DD`

- One public operational branch per WorkDate
- Working → `status: presence_only` + branch address/phone + schedule times
- Off / leave / non-public → `isWorking: false`, `branch: null`, status as classified
- Never returns Camp Caesar while non-public
