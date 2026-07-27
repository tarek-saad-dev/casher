# Booking Phase 6 — Overlap / concurrency

Absolute Emp interval locks + SERIALIZABLE busy re-read prevent double book across branches and overnight representations.

## Phase 6B (proven live)

- Concurrent same-slot different keys → one success / one `SLOT_UNAVAILABLE` or lock timeout.
- Concurrent same key → one booking + replay.

## Phase 6C (proven live)

- **Any-barber vs specific-barber race** — server-selected any-barber and fixed specific-barber cannot both assign the same EmpID; at most one booking per candidate.
- **Cross-branch global Emp race** — same global EmpID at the same absolute interval across GLEEM and Camp Caesar is serialized by the global EmpID interval applock; maximum one success.
- **Multi-service overlap boundaries** — half-open interval policy `[start, end)` enforced using `AbsoluteStartUtc` / `AbsoluteEndUtc`. A competing booking starting exactly at the first booking's end is allowed; any earlier overlap is rejected.
- **Overnight equivalent representation** — canonical `WorkDate=D, time=00:15, dayOffset=1` is accepted and persisted; the alternate `WorkDate=D+1, time=00:15, dayOffset=0` representation is rejected, preventing duplicate slots under two business dates.

## Design-only vs live-proven

Phase 6B rows above were live-proven against `last132`. Phase 6C rows are live-proven by `scripts/verify-booking-phase6c-final-proof.ts` and the matching unit tests.

