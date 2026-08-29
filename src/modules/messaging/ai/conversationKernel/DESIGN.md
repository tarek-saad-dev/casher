# Customer-Led Conversation Kernel V4

## Principle
**CURRENT CUSTOMER MESSAGE IS SOVEREIGN.**

Memory helps resolve references; it never hijacks what the customer is allowed to say.

## Pipeline
```
Inbound → interpretCurrentTurn (TurnFrame + ConstraintDelta)
       → readScopedMemory
       → routeTurn (dialoguePolicy)
       → answer query | pass Phase 2 | human handoff | delegate planner
       → responsePlanner (answer first, no nag)
```

## Scoped memory
- Conversation (recent branch/employee/time)
- Active task (BookingDraft — suspended via taskStack during queries)
- Pending confirmation (invalidated by intervening queries)
- Recent discourse (هناك / نفس الوقت / الأول)

## Flag
`CUSTOMER_LED_CONVERSATION_V4=true|false` (default OFF)

When V4 is ON, it replaces V3 orchestration in `processAiTurn`. V3/V3.1 planner ConstraintDelta remains for booking mutations.

Rollback: set `CUSTOMER_LED_CONVERSATION_V4=false`, keep `CONVERSATION_ORCHESTRATOR_V3=true` if needed.

## Reuse
CI V2 parsers, V3.1 ConstraintDelta, confirmation gate, Phase 2 tools, planner, Phase 4 execute.

## Replace
Stage-dominated turn ownership, automatic booking resume after interruptions, context-bridge nagging on queries.
