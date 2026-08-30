# Booking Management V1 — Design

Date: 2026-08-30  
Flag: `BOOKING_MANAGEMENT_V1` (default **OFF**)  
Optional canary: `BOOKING_MANAGEMENT_CANARY_PHONES` (same semantics as Human Handoff canary)

## Audit (current production)

| Surface | Reality | Reuse |
|---|---|---|
| Create write SoT | `createPublicBooking` + `evaluatePublicBookingSelection` | Do not bypass |
| Upcoming lookup | `listPublicUpcomingBookings` / `getPublicBookingByCode` (`publicBookingReader.ts`) | Read path for AI |
| Cancel write SoT | `cancelPublicBooking` + policy + cancel idempotency | Messaging cancel executes only via this |
| Ops reschedule | `rescheduleBookingMove` / `validateBookingMove` (`bookingRescheduleCore.ts`) | Integrity reference; wrap as **public** reschedule with ownership |
| Holds / claims | `TblBookingHold` (5m TTL), `TblBookingSlotClaim` HOLD/BOOKING | Reuse; no second reservation system |
| Create planner | `TblBotBookingPlan` + `processBookingPlannerTurn` + `executeConfirmedBookingPlan` | **Separate** management plan — do not overload create stages |
| Customer context tool | `get_customer_context` already returns up to 3 upcoming | Add dedicated `get_upcoming_bookings` for manage intents |
| AI write tools | None for cancel/reschedule | Domain commands only from executor |
| V4 kernel | Current message sovereign; confirm gate in `confirmationGate.ts` | Twin gate for management confirms |
| Human Handoff | `aiIsSuppressed` / ControlMode gates in `processAiTurn` | Management mutations only when AI turn allowed (BOT) |
| WA notify | `scheduleCancelWhatsAppAfterCommit` / move events | Reuse; avoid duplicate conversational + template spam |

### Explicitly missing

- `reschedulePublicBooking` (public ownership + idempotency)
- Public modify services / branch as customer WhatsApp flow
- `BookingManagementPlan` persistence
- Target resolver + LastRelevantBooking session fields
- Messaging wiring for manage intents

## Principles

1. **No mutation from ambiguous speech.** Resolve → plan → validate live → preview → explicit confirm → atomic commit → success wording only after commit.
2. **No parallel booking engine.** All writes go through booking domain (`cancelPublicBooking`, new `reschedulePublicBooking` built on schedule integrity + slot claims).
3. **Customer-Led V4.** Ephemeral queries interrupt without forcing management resume. Stale confirmations invalidate.
4. **Human Handoff.** HUMAN / HUMAN_REQUESTED: store only; no cancel/reschedule/plan mutation.
5. **Ownership.** Customer phone (canonical) must own the booking; never expose others by ID guessing.
6. **Language.** Egyptian receptionist; no يا باشا/معلم/…; no "جاري" / fake success before commit.

## Feature flag

```
BOOKING_MANAGEMENT_V1=false|true   # default OFF
BOOKING_MANAGEMENT_CANARY_PHONES=  # empty + ON ⇒ global; non-empty ⇒ allowlist only
```

When OFF: create booking + existing tools unchanged; management planner/tools no-op.

## Module boundary

```
Messaging / V4 / processAiTurn
    ↓
BookingManagementService (messaging module)
    ↓
Domain: cancelPublicBooking | reschedulePublicBooking | listPublicUpcomingBookings | evaluatePublicBookingSelection
    ↓
Repositories / SERIALIZABLE TX / applocks / slot claims
```

Conversation code must not contain SQL mutation.

## Upcoming lookup (J1)

Tool: `get_upcoming_bookings`  
Implementation: wraps `listPublicUpcomingBookings({ phone })` LIVE.  
No durable store of results as facts.

Reply patterns: none / one / numbered list (concise Arabic).

## Target resolution (J2)

`BookingTargetResolver` precedence:

1. Explicit booking code (ownership-checked)
2. Explicit date/time/employee/branch references against candidates
3. `LastRelevantBooking` if still in upcoming set
4. Exactly one eligible upcoming → select
5. Else ask; store `PendingQuestion { expectedAnswerType: BOOKING_SELECTION, candidateBookingIds }`

Ordinal ("الأول"), employee ("بتاع عمر"), date ("الخميس") resolve pending candidates when unambiguous.

## LastRelevantBooking

Bounded session field (in-process `SessionMemory` + optional plan JSON):

`bookingId`, `bookingCode`, display snapshot, `lastReferencedAt`

Updated after create/reschedule/cancel success and after lookup display.  
Never traps: explicit new intent/reference wins; stale if booking no longer upcoming/owned.

## BookingManagementPlan (J3)

New table `TblBotBookingManagementPlan` (parallel to create plan; one ACTIVE per conversation).

```
operation: CANCEL | MODIFY
targetBookingId / BookingCode
originalSnapshotJson
desiredChangesJson   # date?, time?, employee?, branch?, services?
validatedDesiredStateJson
candidateAlternativesJson
stage: RESOLVING_BOOKING | COLLECTING_CHANGE | VALIDATING |
       CHOOSING_ALTERNATIVE | READY_TO_CONFIRM | EXECUTING |
       COMPLETED | FAILED | ABANDONED
confirmationVersion
idempotencyKey
```

Plan is **helper**, not conversation owner. Kernel/ephemeral queries suspend without auto-nag.

## Cancel (J4)

Preview only → confirm → `cancelPublicBooking` with durable idempotency key:

`booking-management:{conversationId}:{planId}:v{confirmationVersion}`

Reuse 30-minute cutoff + approved reason codes.  
Already cancelled → idempotent success.  
Repeated confirm → same result, no duplicate WA notify (existing cancel notify idempotency).

## Modify / reschedule (J5–J14)

Desired state = original snapshot + requested deltas only.  
Validate entire desired state via `validateBookingMove` (excludes self) / public ownership wrapper.  
Optional HOLD: reuse create HOLD claims — no second reservation system.

Atomic commit via `reschedulePublicBooking`:

1. Ownership check (phone)
2. Durable idempotency claim (`TblPublicBookingRescheduleRequest`)
3. `validateBookingMove` + `rescheduleBookingMove` (SERIALIZABLE + schedule locks + slot claims)
4. Optional `BranchID` update when branch delta requested
5. Audit note + commit  
6. Customer WhatsApp template suppressed when AI chat reply owns confirmation

**Service-line changes (add/remove services):** deferred from atomic WhatsApp path in V1 — preview returns reception handoff copy rather than mutating `BookingServices`. Date/time/employee/branch supported.

**Never** cancel-old then create-new outside one coordinated atomic path.

Conflict: desired slot lost → ROLLBACK → original intact → alternatives.

## Confirmation (J12–J13)

Twin of create confirm gate:

- Bot action `ask_management_confirm`
- Pending planId + confirmationVersion in SessionMemory
- Affirmatives only when gate passes
- Query interruption clears pending confirm (same as create)
- Final commit reloads booking + revalidates desired state

## Tools (J25)

| Tool | Role |
|---|---|
| `get_upcoming_bookings` | read |
| `preview_booking_change` | validate desired state, no commit |
| `cancel_booking` | only via confirmed executor path (or tool that stages confirm) |
| `commit_booking_change` | executor only after confirm |

Prefer planner/executor over Gemini free-form write tools. Low-level column updates forbidden.

## Human Handoff / V4 (J18–J19)

- Management turns only when flag ON + phone canary + ControlMode BOT  
- HUMAN/HUMAN_REQUESTED: no plan mutation, no domain writes  
- Interruption: answer hours/price first; invalidate dangerous confirm  

## Notifications (J21)

After cancel/reschedule commit: reuse `scheduleCancelWhatsAppAfterCommit` / move WhatsApp path.  
Conversational “تم …” is the chat reply; template pipeline must remain idempotent (existing tables).

## Observability (J31)

Structured events:  
`booking_management_started|target_resolved|previewed|confirmation_requested|confirmation_invalidated|commit_started|committed|cancelled|conflict|idempotent_replay|failed`

## Rollout

1. Deploy code + schema with flag OFF  
2. Canary phones: lookup → cancel → reschedule → employee → conflict → handoff  
3. Owner chooses global ON  

PASS only after production canaries in J33–J38.
