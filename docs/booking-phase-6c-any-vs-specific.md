# Booking Phase 6C — Any-Barber vs Specific-Barber Race

## Live Scenario

Two disposable barbers (Emp X, Emp Y) are created with identical GLEEM eligibility. Two requests hit the create endpoint behind a real barrier:

- **Request A** — `mode=specific_barber`, `empId=X`
- **Request B** — `mode=any_barber`, candidates `{X, Y}`

Same absolute interval, services, and duration.

## Proven Outcomes

- At most one booking for X and at most one booking for Y.
- No deadlock, no pool acquisition failure, no partial booking.
- Selected EmpIDs match the responses.
- Distinct idempotency keys.

## Locking Mechanics

- `specific_barber` acquires the global EmpID interval applock before insert.
- `any_barber` first acquires the branch+interval+service-set assignment applock, then iterates candidates and acquires each EmpID interval applock.
- The assignment lock serializes the any-barber selection window so it cannot interleave with another any-barber request for the same slot.
- The EmpID interval lock is global and cross-branch; it prevents the specific and any-barber paths from choosing the same barber simultaneously.

## Files

- `src/lib/__tests__/bookingCreateAnyVsSpecificLive.test.ts`
- `src/lib/__tests__/helpers/phase6cSmokeHarness.ts`
- `scripts/verify-booking-phase6c-final-proof.ts`
