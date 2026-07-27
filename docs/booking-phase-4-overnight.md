# Booking Phase 4 — Overnight

WorkDate = opening business day. After-midnight starts use `dayOffset=1`. Slot end must be ≤ shift close (exclusive). Example GLEEM close 01:30, duration 45 → last start 00:45. Evaluated via `evaluateBookingSlotAt` + engine overnight window.
