# Booking Phase 7B — Overnight Cancellation

Canonical columns preserved on cancel:
- `PublicWorkDate` unchanged
- `PublicDayOffset` unchanged
- Absolute interval unchanged (status only)

Availability reopen evaluates under opening **WorkDate**, not shifted calendar-only WorkDate.
Lookup returns cancelled with canonical workDate/dayOffset/time.
