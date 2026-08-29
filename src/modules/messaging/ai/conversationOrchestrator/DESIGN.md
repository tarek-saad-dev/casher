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
