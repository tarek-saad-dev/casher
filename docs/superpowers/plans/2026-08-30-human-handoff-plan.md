# Human Handoff — Implementation Plan (TDD)

Date: 2026-08-30

Every task: failing tests first, then implementation, then green.

## T1 — Feature flag + config
- `HUMAN_HANDOFF_V1` default off
- `HUMAN_HANDOFF_LEASE_MINUTES` default 15
- Test: flag off / on / lease parse

## T2 — Pure domain
- Modes, transitions, version bump, lease extend rules
- Tests 1–7, 12, 16, 19–20 from spec (in-memory)

## T3 — fromMe classifier
- Tests 10, 11, Q cases (automated / ERP / unknown / duplicate / ambiguous)

## T4 — Unanswered turn + resume claim key
- Tests 17, 18, 21, 22, 23

## T5 — Migration SQL
- Additive, idempotent, no DROP TABLE
- Extend ControlMode CHECK to include HUMAN_REQUESTED
- Indexes: ConversationID, Mode+LeaseUntil, resume unique
- Structural test like concierge migrationValidate

## T6 — SQL control repository
- Mock or characterization of MERGE/update with version
- Two-user race: one winner (test 6)

## T7 — Application commands
- requestCustomerHandoff (ack once)
- takeoverErp (conflict)
- returnToBot
- sendHumanErp
- observeManualOutbound
- reconcileExpiredLeases
- Tests 1–27 covering commands with fake repo

## T8 — Wire AI
- Flag off: kernel handoff reply unchanged, no ControlMode write
- Flag on: requestHandoff + HANDOFF_ACK origin in outbox metadata
- Live ControlMode re-check before enqueue
- Tests 13, 14, 15, 24, 25, 26, 27, 28

## T9 — Outbox send gate
- Correlation insert before send
- Suppress BOT when version/mode mismatch
- Test 25, 26

## T10 — fromMe webhook
- `/api/internal/messaging/outbound-observed/whatsapp`
- Same Bearer as inbox webhook
- LID → ExternalContactKey via existing resolver

## T11 — Inbox APIs
- list, get, mark-read, takeover, return, send
- Auth via existing WhatsApp admin
- Tests R: list sort, unread, conflict 409

## T12 — ERP UI
- `/admin/whatsapp/inbox`
- Link from admin WhatsApp page
- Composer disabled under BOT
- Poll 3s
- RTL

## T13 — Workers
- Inbox worker: lease reconciler tick
- Resume schedules AI once via existing `scheduleAiTurn`

## T14 — Messaging regression
- Full `src/modules/messaging/__tests__`
- V4 + Concierge suites
- Commit + push
- Production canary separately (do not PASS without phone proof)
