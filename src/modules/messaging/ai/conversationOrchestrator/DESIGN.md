# Conversation Orchestrator V3 — Design (concise)

## Principle
CURRENT MESSAGE FIRST. Active booking plan is context, never the owner of the turn.

## Pipeline
inbound → TurnFrame → ReferenceResolver → ScopedMemory view → TurnArbitrator
→ DialoguePolicy (query vs mutation) → handlers/tools → ResponsePlan → reply
→ SessionMemory update (lastBotAction, repair)

## Core types
- **TurnFrame**: primaryIntent, scope (ephemeral_query | active_booking | resume | cancel), entities, temporal (now|inherited|explicit), mutatesBookingPlan, isConfirmation, repairMode
- **ScopedMemory**: conversationFacts + activeBooking (plan snapshot) + recentTurns + taskStack
- **TaskStack**: BOOKING (planId, stage) suspended while ephemeral QUERY runs
- **ConfirmationGate**: execute booking ONLY if lastBotAction === ask_booking_confirm AND affirmative AND no intervening query

## Reuse
CI V2 turnIntent/alt search/date/time/normalize, Phase 2 tools, Phase 3 plan persistence, Phase 4 executeConfirmedBookingPlan.

## Replace
Stage-dominated ready_to_confirm fallthrough for queries; blind اه after interrupt; Gemini entities overwriting query turns.

## Untouched
createPublicBooking SoT, WhatsApp transport, cancel/reschedule.

## Flag
CONVERSATION_ORCHESTRATOR_V3 (default OFF until canary; enable true in prod after green). CI V2 remains fallback.

## V3.1 ConstraintDelta + Temporal Repair
Every turn yields action + ConstraintDelta before planner transitions:
- Ordinal selection vs explicit time constraint (`الساعة 11` ≠ shortlist pick)
- Non-candidate time → invalidate candidates/selectedSlot → availability refresh
- Contextual bare hours (night `11`→23:00; morning→11:00)
- Overnight: `1 بالليل`→01:00 (BusinessClock dayOffset; not 13:00)
- Repair signals reject prior interpretation; no repeated identical clarification after new evidence
- Constraint change clears pending confirmation (Phase 4 safety)
ConstraintDelta runs inside the booking planner (not a separate feature flag).

