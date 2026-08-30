# Booking Management V1 — Implementation Plan

Date: 2026-08-30  
Flag: `BOOKING_MANAGEMENT_V1` default OFF  
Spec: `docs/superpowers/specs/2026-08-30-booking-management-design.md`

## Approach

TDD. Ship behind flag. Reuse public cancel + ops reschedule integrity; add public reschedule + messaging management planner. Do not overload `TblBotBookingPlan`.

## Workstreams

### W0 — Flag + docs
- [x] Design + this plan
- [ ] `featureFlag.ts`: `isBookingManagementV1Enabled`, `isBookingManagementActiveForPhone`
- [ ] `.env.example` entries (no production phones)

### W1 — Upcoming lookup
- [ ] Tool `get_upcoming_bookings` wrapping `listPublicUpcomingBookings`
- [ ] Register in `registry.ts` / types
- [ ] Unit tests: none / one / multiple / ownership (mock reader)
- [ ] Concise Arabic composer helpers

### W2 — Management plan persistence
- [ ] Migration `create-tbl-bot-booking-management-plan.sql` (idempotent)
- [ ] Deploy hook if convention requires (or ensure-on-boot like cancel idempotency)
- [ ] Repository + mappers + types/stages
- [ ] Tests: one active plan per conversation

### W3 — Target resolver + LastRelevantBooking
- [ ] `BookingTargetResolver` pure domain + tests (matrix 6–12)
- [ ] SessionMemory fields: `lastRelevantBooking`, `pendingBookingSelection`
- [ ] Kernel/dialogue hooks for manage intents (detect cancel/modify speech)

### W4 — Cancel path
- [ ] `processBookingManagementTurn` CANCEL stages
- [ ] Preview copy → confirm gate → `executeConfirmedManagementPlan` → `cancelPublicBooking`
- [ ] Idempotency key `booking-management:…`
- [ ] Tests matrix 13–19
- [ ] Handoff suppress tests 53–55

### W5 — Public reschedule domain
- [ ] `reschedulePublicBooking` (ownership phone/token, SERIALIZABLE, claims, Absolute*)
- [ ] Reschedule idempotency table (mirror cancel)
- [ ] Fingerprint original + desired state
- [ ] Tests matrix 20–31, 45–48
- [ ] Forbidden: partial column updates from messaging

### W6 — Multi-delta + services + branch
- [ ] Desired-state builder from deltas
- [ ] Live `evaluatePublicBookingSelection` for final combo
- [ ] Alternatives composer (max 2–3)
- [ ] Tests 32–40

### W7 — Confirmation / V4 / language
- [ ] Extend or twin `evaluateBookingConfirmationGate`
- [ ] Stale confirm after query (41–43)
- [ ] Language guards: no جاري / banned titles (64–66)
- [ ] Post-action grounding (60–63)

### W8 — Wire processAiTurn
- [ ] After kernel, if manage intent + flag: management turn before/alongside create planner
- [ ] Create planner remains for CREATE only
- [ ] Observability logs

### W9 — Regression suites
- [ ] Messaging full suite
- [ ] Booking Phase 4 / V2 / claims / V4 / handoff / concierge
- [ ] Record counts in final report

### W10 — Deploy OFF + canaries
- [ ] Commit / push / GHA
- [ ] Verify SHA; migration ran
- [ ] Canary A–F with controlled phone (owner enables flag)
- [ ] Recommend CANARY_ONLY vs READY_FOR_GLOBAL
- [ ] **Do not** issue PASS without production proofs
- [ ] **Do not** start Phase K dashboard

## File map (intended)

```
src/modules/messaging/ai/bookingManagement/
  featureFlag.ts
  types.ts
  targetResolver.ts
  desiredState.ts
  processManagementTurn.ts
  executeConfirmedManagementPlan.ts
  managementPlanRepository.ts
  responseCopy.ts
  observability.ts
src/lib/booking/publicBookingReschedule.ts   # new public SoT
src/lib/booking/publicBookingRescheduleIdempotency.ts
db/migrations/create-tbl-bot-booking-management-plan.sql
db/migrations/add-public-booking-reschedule-idempotency.sql
src/modules/messaging/ai/tools/getUpcomingBookings.ts
src/modules/messaging/__tests__/bookingManagement*.test.ts
```

## Test priority order (fail fast)

1. Flag default OFF  
2. Upcoming lookup  
3. Target resolution / clarification  
4. Cancel preview vs commit  
5. Stale confirm  
6. Reschedule atomic + conflict preserves original  
7. Handoff blocks mutation  
8. Create booking regression  

## Stop / PASS

`BOOKING_MANAGEMENT_V1_PASS` only after J33–J38 production canaries.  
Otherwise `BOOKING_MANAGEMENT_PRODUCTION_CANARY_PENDING`.
